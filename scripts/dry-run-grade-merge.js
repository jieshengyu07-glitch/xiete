#!/usr/bin/env node

const axios = require("axios");
const crypto = require("crypto");
const GradeQuery = require("../src/grade/query");
const config = require("../src/config");
const { mergeGrades } = require("../src/grade/gradeMerger");
const {
  buildGradeFallbackKey,
  cleanText,
  normalizeGrade
} = require("../src/grade/gradeNormalizer");
const credentialStore = require("../src/services/credentialStore");
const { debugXgLaunch } = require("../src/grade/xgSession");
const { httpPortalLogin, continueJwxtSso, userAgent } = require("../src/login/httpJwxtLogin");

function cookieHeader(cookies, targetUrl) {
  const host = new URL(targetUrl).hostname.toLowerCase();
  return (Array.isArray(cookies) ? cookies : [])
    .filter(cookie => {
      const domain = cleanText(cookie && cookie.domain).replace(/^\./, "").toLowerCase();
      return cookie && cookie.name && (host === domain || host.endsWith("." + domain));
    })
    .map(cookie => cookie.name + "=" + cookie.value)
    .join("; ");
}

async function withQuietConsole(fn) {
  if (process.env.DRY_RUN_VERBOSE === "1") return fn();
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

async function fetchJwxtGrades(credentials) {
  const portal = await httpPortalLogin(credentials.studentId, credentials.password);
  const jwxt = await continueJwxtSso(portal.cookieJar);
  const base = config.urls.jwxt.base;
  const client = axios.create({
    headers: {
      "User-Agent": userAgent(),
      "Cookie": cookieHeader(jwxt.cookies, base)
    },
    timeout: 30000,
    withCredentials: true
  });
  const query = new GradeQuery(client);
  const terms = [
    { xnm: "2023", xqm: "3" },
    { xnm: "2023", xqm: "12" },
    { xnm: "2024", xqm: "3" },
    { xnm: "2024", xqm: "12" },
    { xnm: "2025", xqm: "3" },
    { xnm: "2025", xqm: "12" }
  ];
  const all = [];
  for (const term of terms) {
    const grades = await query.query(term.xnm, term.xqm);
    all.push(...grades);
  }
  return all;
}

async function fetchXgGrades() {
  const result = await debugXgLaunch();
  return Array.isArray(result.xgGrades) ? result.xgGrades : [];
}

function courseHash(grade) {
  const normalized = normalizeGrade(grade, grade && grade.source);
  const source = [
    normalized.term,
    normalized.courseCode,
    normalized.courseName,
    normalized.credit
  ].join("|");
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 8);
}

function hasSource(grade, source) {
  return Array.isArray(grade && grade.sources) && grade.sources.includes(source);
}

function finalSourceCounts(grades) {
  const result = {
    sourceBothCount: 0,
    jwxtOnlyFinalCount: 0,
    xgOnlyFinalCount: 0
  };
  grades.forEach(grade => {
    const jwxt = hasSource(grade, "jwxt");
    const xg = hasSource(grade, "xg");
    if (jwxt && xg) result.sourceBothCount += 1;
    else if (jwxt) result.jwxtOnlyFinalCount += 1;
    else if (xg) result.xgOnlyFinalCount += 1;
  });
  return result;
}

function sameTermCreditCandidates(item, jwxtGrades) {
  return jwxtGrades.filter(other =>
    item.term &&
    other.term === item.term &&
    item.credit &&
    other.credit === item.credit
  );
}

function inspectXgUnmatched(xgOnlyFinal, jwxtGrades) {
  const possibleNameMismatchHashes = [];
  xgOnlyFinal.forEach(item => {
    const candidates = sameTermCreditCandidates(item, jwxtGrades);
    if (candidates.length) possibleNameMismatchHashes.push(courseHash(item));
  });
  return {
    xgUnmatchedCount: xgOnlyFinal.length,
    possibleNameMismatchDuplicateCount: possibleNameMismatchHashes.length,
    confidentXgOnlyCount: xgOnlyFinal.length - possibleNameMismatchHashes.length,
    possibleNameMismatchCourseHashes: possibleNameMismatchHashes
  };
}

function verifyMergeSafety(finalGrades) {
  const result = {
    bothPreferredJwxtOk: true,
    bothSourcesOk: true,
    conflictSourceScoresOk: true,
    xgDidNotOverwriteJwxtScoreOk: true,
    xgEmptyDidNotOverwriteJwxtOk: true
  };

  finalGrades.forEach(grade => {
    const both = hasSource(grade, "jwxt") && hasSource(grade, "xg");
    if (!both) return;
    if (grade.preferredSource !== "jwxt") result.bothPreferredJwxtOk = false;
    if (!grade.sources.includes("jwxt") || !grade.sources.includes("xg")) result.bothSourcesOk = false;
    const sourceScores = grade.sourceScores || {};
    if (sourceScores.jwxt && sourceScores.xg && sourceScores.jwxt !== sourceScores.xg) {
      if (!grade.hasConflict) result.conflictSourceScoresOk = false;
      if (grade.score !== sourceScores.jwxt) result.xgDidNotOverwriteJwxtScoreOk = false;
    }
    ["courseCode", "courseName", "credit", "term"].forEach(field => {
      if (!cleanText(grade[field])) result.xgEmptyDidNotOverwriteJwxtOk = false;
    });
  });

  return result;
}

function keySet(grades) {
  return new Set(grades.map(grade => buildGradeFallbackKey(grade)).filter(key => key && key !== "||"));
}

async function main() {
  const credentials = credentialStore.getJwxtCredentials();
  if (!credentials || !credentials.studentId || !credentials.password) {
    throw new Error("CAMPUS_LOGIN_REQUIRED");
  }

  const [jwxtRaw, xgRaw] = await withQuietConsole(async () => Promise.all([
    fetchJwxtGrades(credentials),
    fetchXgGrades()
  ]));

  const jwxtGrades = jwxtRaw.map(grade => normalizeGrade({ ...grade, source: "jwxt" }, "jwxt"));
  const xgGrades = xgRaw.map(grade => normalizeGrade({ ...grade, source: "xg" }, "xg"));
  const mergeResult = mergeGrades(jwxtGrades, xgGrades);
  const finalGrades = mergeResult.grades;
  const counts = finalSourceCounts(finalGrades);
  const xgOnlyFinal = finalGrades.filter(grade => hasSource(grade, "xg") && !hasSource(grade, "jwxt"));
  const xgUnmatched = inspectXgUnmatched(xgOnlyFinal, jwxtGrades);
  const safety = verifyMergeSafety(finalGrades);
  const jwxtKeys = keySet(jwxtGrades);
  const xgKeys = keySet(xgGrades);
  const matchedCount = xgGrades.filter(grade => jwxtKeys.has(buildGradeFallbackKey(grade))).length;
  const addedFromXgCount = xgGrades.filter(grade => !jwxtKeys.has(buildGradeFallbackKey(grade))).length;
  const jwxtOnlyByFallbackCount = jwxtGrades.filter(grade => !xgKeys.has(buildGradeFallbackKey(grade))).length;

  console.log("jwxtCount=" + jwxtRaw.length);
  console.log("xgCount=" + xgRaw.length);
  console.log("matchedCount=" + matchedCount);
  console.log("addedFromXgCount=" + addedFromXgCount);
  console.log("conflictCount=" + finalGrades.filter(grade => grade.hasConflict).length);
  console.log("finalCount=" + finalGrades.length);
  console.log("sourceBothCount=" + counts.sourceBothCount);
  console.log("jwxtOnlyFinalCount=" + counts.jwxtOnlyFinalCount);
  console.log("xgOnlyFinalCount=" + counts.xgOnlyFinalCount);
  console.log("jwxtOnlyByFallbackCount=" + jwxtOnlyByFallbackCount);
  console.log("xgUnmatchedCount=" + xgUnmatched.xgUnmatchedCount);
  console.log("possibleNameMismatchDuplicateCount=" + xgUnmatched.possibleNameMismatchDuplicateCount);
  console.log("confidentXgOnlyCount=" + xgUnmatched.confidentXgOnlyCount);
  console.log("possibleNameMismatchCourseHashes=" + JSON.stringify(xgUnmatched.possibleNameMismatchCourseHashes));
  console.log("bothPreferredJwxtOk=" + safety.bothPreferredJwxtOk);
  console.log("bothSourcesOk=" + safety.bothSourcesOk);
  console.log("conflictSourceScoresOk=" + safety.conflictSourceScoresOk);
  console.log("xgDidNotOverwriteJwxtScoreOk=" + safety.xgDidNotOverwriteJwxtScoreOk);
  console.log("xgEmptyDidNotOverwriteJwxtOk=" + safety.xgEmptyDidNotOverwriteJwxtOk);
  console.log("sourceIncreaseOnlyCanNotify=false");
}

main().catch(err => {
  console.log("errorCode=" + ((err && err.code) || (err && err.message) || "DRY_RUN_GRADE_MERGE_FAILED"));
  process.exitCode = 1;
});
