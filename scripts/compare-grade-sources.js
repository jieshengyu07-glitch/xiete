#!/usr/bin/env node

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const GradeQuery = require("../src/grade/query");
const credentialStore = require("../src/services/credentialStore");
const { httpPortalLogin, continueJwxtSso, userAgent } = require("../src/login/httpJwxtLogin");
const { debugXgLaunch } = require("../src/grade/xgSession");
const { mergeGrades } = require("../src/grade/gradeMerger");
const {
  buildGradeFallbackKey,
  buildGradeKey,
  cleanText,
  normalizeCredit,
  normalizeGrade,
  normalizeScore
} = require("../src/grade/gradeNormalizer");
const config = require("../src/config");

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
  if (process.env.COMPARE_VERBOSE === "1") return fn();
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

function courseTypeBucket(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return "unknown";
  if (text.includes("required") || text.includes("必修") || text.includes("蹇呬慨")) return "required";
  if (
    text.includes("elective") ||
    text.includes("选修") ||
    text.includes("任选") ||
    text.includes("限选") ||
    text.includes("閫変慨") ||
    text.includes("浠婚") ||
    text.includes("闄愰")
  ) {
    return "elective";
  }
  return "unknown";
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function sortedObject(obj) {
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {});
}

function sourceName(source, grade) {
  const item = grade || {};
  if (source === "jwxt") return cleanText(item.kcmc || item.KCMC || item.courseName);
  return cleanText(item.courseName || item.kcmc || item.KCMC);
}

function sourceTerm(source, grade) {
  const item = grade || {};
  if (source === "jwxt") {
    const xnm = cleanText(item.xnm || item.XNM);
    const xqm = cleanText(item.xqm || item.XQM);
    return xnm || xqm ? xnm + "|" + xqm : cleanText(item.term || item.termName || item.semester);
  }
  return cleanText(item.term || item.termName || item.semester || item.xnm || item.XNM);
}

function sourceScore(grade) {
  return cleanScoreText((grade && (grade.score || grade.cj || grade.CJ || grade.grade)) || "");
}

function cleanScoreText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\u3000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScoreValue(value) {
  const text = cleanScoreText(value);
  if (!text) return "";
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return String(number);
}

function scoreFieldFromRaw(raw) {
  const fields = ["CJ", "cj", "bfzcj", "BFZCJ", "bkcj", "BKCJ", "cxcj", "CXCJ", "jd", "JD"];
  for (const field of fields) {
    if (raw && raw[field] !== undefined && raw[field] !== null && String(raw[field]).trim() !== "") return field;
  }
  return "";
}

function primaryKey(grade) {
  const normalized = normalizeGrade(grade, grade && grade.source);
  return normalized.term && normalized.courseCode ? normalized.term + "|" + normalized.courseCode : "";
}

function nameKey(grade) {
  const normalized = normalizeGrade(grade, grade && grade.source);
  return normalized.term && normalized.courseName ? normalized.term + "|" + normalized.courseName : "";
}

function buildUniqueIndex(items, keyFn) {
  const counts = new Map();
  const index = new Map();
  items.forEach((item, idx) => {
    const key = keyFn(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!index.has(key)) index.set(key, idx);
  });
  for (const [key, count] of counts) {
    if (count !== 1) index.delete(key);
  }
  return index;
}

function countByKey(items, keyFn) {
  const counts = new Map();
  items.forEach(item => {
    const key = keyFn(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function matchByKey(jwxtGrades, xgGrades, jwxtUsed, xgUsed, matches, keyFn, uniqueOnly) {
  const xgIndex = uniqueOnly ? buildUniqueIndex(xgGrades, keyFn) : new Map();
  if (!uniqueOnly) {
    xgGrades.forEach((grade, idx) => {
      const key = keyFn(grade);
      if (!key || xgIndex.has(key)) return;
      xgIndex.set(key, idx);
    });
  }
  const jwxtUnique = uniqueOnly ? buildUniqueIndex(jwxtGrades, keyFn) : null;

  jwxtGrades.forEach((grade, jwxtIdx) => {
    if (jwxtUsed.has(jwxtIdx)) return;
    const key = keyFn(grade);
    if (!key) return;
    if (uniqueOnly && jwxtUnique.get(key) !== jwxtIdx) return;
    const xgIdx = xgIndex.get(key);
    if (xgIdx === undefined || xgUsed.has(xgIdx)) return;
    jwxtUsed.add(jwxtIdx);
    xgUsed.add(xgIdx);
    matches.push({ jwxtIdx, xgIdx, key });
  });
}

function compareGrades(jwxtRaw, xgRaw) {
  const jwxt = jwxtRaw.map(grade => normalizeGrade({ ...grade, source: "jwxt" }, "jwxt"));
  const xg = xgRaw.map(grade => normalizeGrade({ ...grade, source: "xg" }, "xg"));
  mergeGrades(jwxt, xg);

  const jwxtUsed = new Set();
  const xgUsed = new Set();
  const matches = [];

  matchByKey(jwxt, xg, jwxtUsed, xgUsed, matches, primaryKey, false);
  matchByKey(jwxt, xg, jwxtUsed, xgUsed, matches, buildGradeFallbackKey, false);
  matchByKey(jwxt, xg, jwxtUsed, xgUsed, matches, nameKey, true);

  let rawConflictCount = 0;
  let normalizedEqualCount = 0;
  let scoreConflictCount = 0;
  let termFormatOnlyDifferenceCount = 0;
  let nameFormatOnlyDifferenceCount = 0;

  matches.forEach(match => {
    const left = jwxt[match.jwxtIdx];
    const right = xg[match.xgIdx];
    const leftScore = sourceScore(left);
    const rightScore = sourceScore(right);
    const leftNormalizedScore = normalizeScoreValue(leftScore);
    const rightNormalizedScore = normalizeScoreValue(rightScore);
    if (leftScore !== rightScore) rawConflictCount += 1;
    if (leftScore !== rightScore && leftNormalizedScore === rightNormalizedScore) normalizedEqualCount += 1;
    if (leftNormalizedScore !== rightNormalizedScore) scoreConflictCount += 1;
    if (left.term && right.term && left.term === right.term && sourceTerm("jwxt", left) !== sourceTerm("xg", right)) {
      termFormatOnlyDifferenceCount += 1;
    }
    if (left.courseName && right.courseName && left.courseName === right.courseName && sourceName("jwxt", left) !== sourceName("xg", right)) {
      nameFormatOnlyDifferenceCount += 1;
    }
  });

  const jwxtOnly = jwxt.filter((_, idx) => !jwxtUsed.has(idx));
  const xgOnly = xg.filter((_, idx) => !xgUsed.has(idx));

  return {
    jwxt,
    xg,
    matches,
    matchedCount: matches.length,
    jwxtOnly,
    xgOnly,
    rawConflictCount,
    normalizedEqualCount,
    scoreConflictCount,
    termFormatOnlyDifferenceCount,
    nameFormatOnlyDifferenceCount
  };
}

function isNumericScore(value) {
  return /^-?\d+(?:\.\d+)?$/.test(cleanScoreText(value));
}

function numericValue(value) {
  return Number(cleanScoreText(value));
}

function scoreType(left, right) {
  const l = cleanScoreText(left);
  const r = cleanScoreText(right);
  if (!l || !r) return "missingVsValue";
  if (isNumericScore(l) && isNumericScore(r)) return "numeric";
  return "text";
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

function conflictDiagnostics(comparison) {
  const nameCountsJwxt = countByKey(comparison.jwxt, nameKey);
  const nameCountsXg = countByKey(comparison.xg, nameKey);
  const records = [];
  const distribution = { "0-1": 0, "1-5": 0, "5-10": 0, "10+": 0 };
  const stats = {
    numericConflictCount: 0,
    textConflictCount: 0,
    missingVsValueCount: 0,
    jwxtHigherCount: 0,
    xgHigherCount: 0,
    equalAfterNumericNormalizeCount: 0,
    conflictsWithUniqueMatch: 0,
    conflictsWithAmbiguousMatch: 0,
    conflictsWithCreditMismatch: 0,
    conflictsWithDuplicateCourseName: 0
  };

  comparison.matches.forEach(match => {
    const left = comparison.jwxt[match.jwxtIdx];
    const right = comparison.xg[match.xgIdx];
    const jwxtScore = sourceScore(left);
    const xgScore = sourceScore(right);
    const jwxtScoreNormalized = normalizeScoreValue(jwxtScore);
    const xgScoreNormalized = normalizeScoreValue(xgScore);
    if (jwxtScore !== xgScore && jwxtScoreNormalized === xgScoreNormalized) {
      stats.equalAfterNumericNormalizeCount += 1;
      return;
    }
    if (jwxtScoreNormalized === xgScoreNormalized) {
      return;
    }

    const type = scoreType(jwxtScoreNormalized, xgScoreNormalized);
    const key = nameKey(left);
    const duplicateCourseName = key && ((nameCountsJwxt.get(key) || 0) > 1 || (nameCountsXg.get(key) || 0) > 1);
    const creditMismatch = left.credit && right.credit && left.credit !== right.credit;
    const uniqueMatch = left.term === right.term &&
      left.courseName === right.courseName &&
      !creditMismatch &&
      !duplicateCourseName;

    if (creditMismatch) stats.conflictsWithCreditMismatch += 1;
    if (duplicateCourseName) stats.conflictsWithDuplicateCourseName += 1;
    if (uniqueMatch) stats.conflictsWithUniqueMatch += 1;
    else stats.conflictsWithAmbiguousMatch += 1;

    let absoluteDifference = null;
    if (type === "numeric") {
      stats.numericConflictCount += 1;
      const diff = Math.abs(numericValue(jwxtScoreNormalized) - numericValue(xgScoreNormalized));
      absoluteDifference = diff.toFixed(2);
      if (diff <= 1) distribution["0-1"] += 1;
      else if (diff <= 5) distribution["1-5"] += 1;
      else if (diff <= 10) distribution["5-10"] += 1;
      else distribution["10+"] += 1;
      if (numericValue(jwxtScoreNormalized) > numericValue(xgScoreNormalized)) stats.jwxtHigherCount += 1;
      else if (numericValue(xgScoreNormalized) > numericValue(jwxtScoreNormalized)) stats.xgHigherCount += 1;
    } else if (type === "missingVsValue") {
      stats.missingVsValueCount += 1;
    } else {
      stats.textConflictCount += 1;
    }

    records.push({
      courseHash: courseHash(left),
      term: left.term || right.term || "unknown",
      jwxtScore,
      xgScore,
      jwxtScoreNormalized,
      xgScoreNormalized,
      scoreType: type,
      absoluteDifference
    });
  });

  return { records, stats, distribution };
}

function writeConflictDebugFile(records) {
  const dir = path.join(config.dataDir, "debug");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "grade-score-conflicts.json"),
    JSON.stringify(records, null, 2),
    "utf8"
  );
}

function availableJwxtScoreFields(rawGrades) {
  const fields = ["cj", "CJ", "cjzt", "CJZT", "bfzcj", "BFZCJ", "cjbz", "CJBZ", "jd", "JD", "bkcj", "BKCJ", "cxcj", "CXCJ"];
  const found = new Set();
  rawGrades.forEach(grade => {
    const raw = (grade && grade.raw) || grade || {};
    fields.forEach(field => {
      if (raw[field] !== undefined && raw[field] !== null && String(raw[field]).trim() !== "") found.add(field);
    });
  });
  return Array.from(found).sort();
}

function detectedJwxtScoreField(rawGrades) {
  const counts = {};
  rawGrades.forEach(grade => {
    const field = scoreFieldFromRaw((grade && grade.raw) || grade);
    if (field) counts[field] = (counts[field] || 0) + 1;
  });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "none";
}

function onlyReasonCounts(sourceItems, oppositeItems) {
  const result = {
    termMismatch: 0,
    nameMismatch: 0,
    creditMismatch: 0,
    ambiguousCandidate: 0,
    genuineSourceOnly: 0
  };

  sourceItems.forEach(item => {
    const sameTermNameCredit = oppositeItems.filter(other =>
      item.term && other.term === item.term &&
      item.courseName && other.courseName === item.courseName &&
      item.credit && other.credit === item.credit
    );
    const sameTermName = oppositeItems.filter(other =>
      item.term && other.term === item.term &&
      item.courseName && other.courseName === item.courseName
    );
    const sameNameCredit = oppositeItems.filter(other =>
      item.courseName && other.courseName === item.courseName &&
      item.credit && other.credit === item.credit
    );
    const sameTermCredit = oppositeItems.filter(other =>
      item.term && other.term === item.term &&
      item.credit && other.credit === item.credit
    );

    if (sameTermNameCredit.length) result.ambiguousCandidate += 1;
    else if (sameTermName.length > 1) result.ambiguousCandidate += 1;
    else if (sameTermName.length === 1) result.creditMismatch += 1;
    else if (sameNameCredit.length) result.termMismatch += 1;
    else if (sameTermCredit.length) result.nameMismatch += 1;
    else result.genuineSourceOnly += 1;
  });

  return result;
}

function missingCount(grades, selector) {
  return grades.filter(grade => !cleanText(selector(grade))).length;
}

function aggregateByTerm(grades) {
  const result = {};
  grades.forEach(grade => increment(result, grade.term || "unknown"));
  return sortedObject(result);
}

function aggregateByCourseType(grades) {
  const result = { required: 0, elective: 0, unknown: 0 };
  grades.forEach(grade => increment(result, courseTypeBucket(grade.courseType)));
  return result;
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
  return {
    grades: Array.isArray(result.xgGrades) ? result.xgGrades : [],
    headers: Array.isArray(result.xgScoreHeaders) ? result.xgScoreHeaders : []
  };
}

function printResult(jwxtRaw, xgRaw, xgMeta, comparison, conflictInfo) {
  const xgScoreColumnIndex = 5;
  const xgScoreHeader = xgMeta.headers[xgScoreColumnIndex - 1] || "none";
  console.log("jwxtCount=" + jwxtRaw.length);
  console.log("xgCount=" + xgRaw.length);
  console.log("matchedCount=" + comparison.matchedCount);
  console.log("jwxtOnlyCount=" + comparison.jwxtOnly.length);
  console.log("xgOnlyCount=" + comparison.xgOnly.length);
  console.log("rawConflictCount=" + comparison.rawConflictCount);
  console.log("normalizedEqualCount=" + comparison.normalizedEqualCount);
  console.log("realConflictCount=" + comparison.scoreConflictCount);
  console.log("scoreConflictCount=" + comparison.scoreConflictCount);
  console.log("termFormatOnlyDifferenceCount=" + comparison.termFormatOnlyDifferenceCount);
  console.log("nameFormatOnlyDifferenceCount=" + comparison.nameFormatOnlyDifferenceCount);
  console.log("jwxtOnlyByTerm=" + JSON.stringify(aggregateByTerm(comparison.jwxtOnly)));
  console.log("jwxtOnlyByCourseType=" + JSON.stringify(aggregateByCourseType(comparison.jwxtOnly)));
  console.log("xgOnlyByTerm=" + JSON.stringify(aggregateByTerm(comparison.xgOnly)));
  console.log("xgOnlyByCourseType=" + JSON.stringify(aggregateByCourseType(comparison.xgOnly)));
  console.log("jwxtMissingCourseCodeCount=" + missingCount(comparison.jwxt, grade => grade.courseCode));
  console.log("xgMissingCourseCodeCount=" + missingCount(comparison.xg, grade => grade.courseCode));
  console.log("jwxtMissingCreditCount=" + missingCount(comparison.jwxt, grade => normalizeCredit(grade.credit)));
  console.log("xgMissingCreditCount=" + missingCount(comparison.xg, grade => normalizeCredit(grade.credit)));
  console.log("jwxtMissingTermCount=" + missingCount(comparison.jwxt, grade => grade.term));
  console.log("xgMissingTermCount=" + missingCount(comparison.xg, grade => grade.term));
  console.log("jwxtScoreField=" + detectedJwxtScoreField(jwxtRaw));
  console.log("xgScoreHeader=" + xgScoreHeader);
  console.log("xgScoreColumnIndex=" + xgScoreColumnIndex);
  console.log("jwxtAvailableScoreFields=" + JSON.stringify(availableJwxtScoreFields(jwxtRaw)));
  console.log("xgScoreHeaders=" + JSON.stringify(xgMeta.headers));
  console.log("numericConflictCount=" + conflictInfo.stats.numericConflictCount);
  console.log("textConflictCount=" + conflictInfo.stats.textConflictCount);
  console.log("missingVsValueCount=" + conflictInfo.stats.missingVsValueCount);
  console.log("differenceDistribution=" + JSON.stringify(conflictInfo.distribution));
  console.log("jwxtHigherCount=" + conflictInfo.stats.jwxtHigherCount);
  console.log("xgHigherCount=" + conflictInfo.stats.xgHigherCount);
  console.log("equalAfterNumericNormalizeCount=" + conflictInfo.stats.equalAfterNumericNormalizeCount);
  console.log("conflictsWithUniqueMatch=" + conflictInfo.stats.conflictsWithUniqueMatch);
  console.log("conflictsWithAmbiguousMatch=" + conflictInfo.stats.conflictsWithAmbiguousMatch);
  console.log("conflictsWithCreditMismatch=" + conflictInfo.stats.conflictsWithCreditMismatch);
  console.log("conflictsWithDuplicateCourseName=" + conflictInfo.stats.conflictsWithDuplicateCourseName);
  console.log("jwxtOnlyReasonCounts=" + JSON.stringify(onlyReasonCounts(comparison.jwxtOnly, comparison.xg)));
  console.log("xgOnlyReasonCounts=" + JSON.stringify(onlyReasonCounts(comparison.xgOnly, comparison.jwxt)));
  console.log("scoreConflictDebugFile=data/debug/grade-score-conflicts.json");
}

async function main() {
  const credentials = credentialStore.getJwxtCredentials();
  if (!credentials || !credentials.studentId || !credentials.password) {
    throw new Error("CAMPUS_LOGIN_REQUIRED");
  }

  const [jwxtGrades, xgResult] = await withQuietConsole(async () => Promise.all([
    fetchJwxtGrades(credentials),
    fetchXgGrades()
  ]));
  const xgGrades = xgResult.grades;
  const comparison = compareGrades(jwxtGrades, xgGrades);
  const conflictInfo = conflictDiagnostics(comparison);
  writeConflictDebugFile(conflictInfo.records);
  printResult(jwxtGrades, xgGrades, xgResult, comparison, conflictInfo);
}

main().catch(err => {
  console.log("errorCode=" + ((err && err.code) || (err && err.message) || "COMPARE_GRADE_SOURCES_FAILED"));
  process.exitCode = 1;
});
