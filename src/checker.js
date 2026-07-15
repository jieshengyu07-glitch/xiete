const fs = require("fs");
const path = require("path");
const axios = require("axios");
const storage = require("./db/storage");
const { createStorageForUser } = require("./db/storage");
const { httpJwxtLogin } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");
const { getUserPaths } = require("./services/userPaths");
const { classifyJwxtLoginError } = require("./services/jwxtLoginError");
const { queryXgScores } = require("./grade/xgScoreQuery");
const { ensureXgScoreSession } = require("./grade/xgSession");
const config = require("./config");
const { recoverCampusSession } = require("./sync/campusSessionRecovery");

const COOKIE_FILE = path.join(config.dataDir, "cookies.json");

// Ensure data dir exists
const DATA_DIR = path.dirname(COOKIE_FILE);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function legacyEnvCookiesAllowed() {
  return process.env.NODE_ENV === "development" ||
    String(process.env.LEGACY_SINGLE_USER_MODE || "") === "1";
}

// Development and explicit legacy single-user scripts may initialize the
// legacy root cookie file. User-scoped requests never use this fallback.
if (process.env.COOKIES_JSON && legacyEnvCookiesAllowed()) {
  try {
    const parsed = JSON.parse(process.env.COOKIES_JSON);
    if (Array.isArray(parsed) && parsed.length > 0 && !fs.existsSync(COOKIE_FILE)) {
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(parsed, null, 2));
      console.log("[checker] Init cookies from COOKIES_JSON env var (" + parsed.length + " entries)");
    }
  } catch (e) {
    console.error("[checker] Failed to parse COOKIES_JSON env var:", e.message);
  }
}

function cookieFile(userId) {
  return userId ? getUserPaths(userId).cookiesPath : COOKIE_FILE;
}

function scopeLabel(userId) {
  return userId ? "user" : "legacy";
}

function writeJsonAtomic(file, data) {
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } catch (err) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (cleanupErr) {}
    throw err;
  }
}

function loadCookies(userId) {
  const file = cookieFile(userId);
  console.log("[user-scope] loadCookies scope=" + scopeLabel(userId));
  // Try file first
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { console.error("[checker] Failed to parse cookies.json"); }
  }
  // Only the legacy, non-user scope may read COOKIES_JSON, and only when
  // explicitly running in development or legacy single-user mode.
  if (!userId && process.env.COOKIES_JSON && legacyEnvCookiesAllowed()) {
    try { return JSON.parse(process.env.COOKIES_JSON); } catch {}
  }
  return null;
}

function isJwglxtPath(cookiePath) {
  return cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
}

function selectJwxtGradeCookies(cookies) {
  var list = Array.isArray(cookies) ? cookies : [];
  var route = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/";
  });
  var jsession = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path);
  });
  var rememberMe = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path);
  });
  return [route, jsession, rememberMe].filter(Boolean);
}

function buildCookieHeader(cookies, domainPattern) {
  if (domainPattern === "newjwc.tyust.edu.cn") {
    var selected = selectJwxtGradeCookies(cookies);
    if (selected.some(function(c) { return c.name === "JSESSIONID"; })) {
      return selected.map(function(c) { return c.name + "=" + c.value; }).join("; ");
    }
  }
  return cookies.filter(c => String(c.domain || "").includes(domainPattern)).map(c => c.name + "=" + c.value).join("; ");
}

function writeCookies(cookiesData, userId) {
  const file = cookieFile(userId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(file, cookiesData);
  console.log("[user-scope] writeCookies scope=" + scopeLabel(userId) + " count=" + (Array.isArray(cookiesData) ? cookiesData.length : 0));
}

function deleteCookies(userId) {
  const file = cookieFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log("[user-scope] deleteCookies scope=" + scopeLabel(userId));
}


const ALL_TERMS = [
  {xnm:"2023",xqm:"3"},{xnm:"2023",xqm:"12"},
  {xnm:"2024",xqm:"3"},{xnm:"2024",xqm:"12"},
  {xnm:"2025",xqm:"3"},{xnm:"2025",xqm:"12"},
];

function gradeQueryConcurrency() {
  const configured = Number(process.env.GRADE_QUERY_CONCURRENCY || 3);
  if (!Number.isFinite(configured)) return 3;
  return Math.max(1, Math.min(6, Math.floor(configured)));
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async function() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function fail(cookieStatus, message, extra) {
  var result = Object.assign({
    success: false,
    error: cookieStatus,
    cookieStatus: cookieStatus,
    message: message || cookieStatus
  }, extra || {});
  console.log("[checker] " + cookieStatus + ": " + result.message);
  return result;
}

function isJwxtUnavailableError(err) {
  const code = String((err && err.code) || "");
  const message = String((err && err.message) || "").toLowerCase();
  return [
    "ECONNABORTED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ENETUNREACH",
    "ERR_BAD_RESPONSE"
  ].includes(code) ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("socket hang up") ||
    message.includes("enotfound") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("econnaborted") ||
    message.includes("eai_again");
}

function isLoginPage(data) {
  if (typeof data !== "string") return false;
  return data.includes("login_slogin.html") ||
    data.includes("/jwglxt/xtgl/login") ||
    data.includes("用户登录") ||
    data.includes("用户名");
}

function isEmptyResponse(data) {
  return data === null || data === undefined || data === "";
}

function classifyResponse(resp) {
  if (!resp) return { status: "jwxt_unavailable", message: "No response from JWXT" };
  if (resp.status === 901 || resp.status === 403 || resp.status === 302) {
    return { status: "cookie_expired", message: "JWXT returned HTTP " + resp.status };
  }
  if (resp.status >= 500) {
    return { status: "jwxt_unavailable", message: "JWXT returned HTTP " + resp.status };
  }
  if (isEmptyResponse(resp.data)) {
    return { status: "jwxt_unavailable", message: "JWXT returned empty response" };
  }
  if (isLoginPage(resp.data)) {
    return { status: "cookie_expired", message: "JWXT returned login page" };
  }
  if (resp.status !== 200) {
    return { status: "query_error", message: "JWXT returned HTTP " + resp.status };
  }
  return null;
}

function attachTermToGrade(grade, term) {
  var item = grade || {};
  item.xnm = term.xnm || item.xnm || item.XNM;
  item.xqm = term.xqm || item.xqm || item.XQM;
  item.XNM = item.xnm;
  item.XQM = item.xqm;
  item.source = item.source || "jwxt";
  return item;
}

function schoolYearName(xnm) {
  if (!xnm) return "未知学年";
  var text = String(xnm);
  if (/^\d{4}$/.test(text)) return text + "-" + (Number(text) + 1);
  return text;
}

function termName(xnm, xqm) {
  var text = String(xqm || "");
  var name = "未知学期";
  if (text === "3") name = "第1学期";
  else if (text === "12") name = "第2学期";
  else if (text) name = text;
  return schoolYearName(xnm) + "学年" + name;
}

function gradeCourseName(grade) {
  return grade.KCMC || grade.kcmc || grade.courseName || grade.course || "";
}

function gradeScore(grade) {
  return grade.CJ || grade.cj || grade.score || "";
}

function gradeXnm(grade) {
  return grade.XNM || grade.xnm || "";
}

function gradeXqm(grade) {
  return grade.XQM || grade.xqm || "";
}

function gradeCredit(grade) {
  return grade.XF || grade.xf || grade.credit || "";
}

function addedChangeRecord(grade) {
  var xnm = gradeXnm(grade);
  var xqm = gradeXqm(grade);
  return {
    type: "added",
    kcmc: gradeCourseName(grade),
    oldCj: "",
    newCj: gradeScore(grade),
    xnm: xnm,
    xqm: xqm,
    termName: termName(xnm, xqm)
  };
}

function changedChangeRecord(change) {
  var newGrade = change.newGrade || {};
  var oldGrade = change.oldGrade || {};
  var xnm = change.xnm || gradeXnm(newGrade) || gradeXnm(oldGrade);
  var xqm = change.xqm || gradeXqm(newGrade) || gradeXqm(oldGrade);
  return {
    type: "changed",
    kcmc: change.kcmc || change.course || gradeCourseName(newGrade) || gradeCourseName(oldGrade),
    oldCj: change.oldCj || change.old || gradeScore(oldGrade),
    newCj: change.newCj || change.new || gradeScore(newGrade),
    xnm: xnm,
    xqm: xqm,
    termName: termName(xnm, xqm)
  };
}

function buildGradeChangeRecords(diff) {
  var records = [];
  (diff.added || []).forEach(function(grade) {
    records.push(addedChangeRecord(grade));
  });
  (diff.changed || []).forEach(function(change) {
    records.push(changedChangeRecord(change));
  });
  return records;
}

function isCookieExpiredResult(result) {
  return result && (result.cookieStatus === "cookie_expired" || result.error === "cookie_expired");
}

function isLoginRequiredResult(result) {
  return result && (result.cookieStatus === "login_required" || result.error === "login_required");
}

function shouldAttemptCookieRefresh(result, userId) {
  if (isCookieExpiredResult(result)) return true;
  return isLoginRequiredResult(result) && Boolean(credentialStore.getJwxtCredentials(userId));
}

function recoveryNeedsAccountRelogin(code) {
  const transientCodes = [
    "JWXT_UNAVAILABLE",
    "JWXT_TIMEOUT",
    "XG_SCORE_QUERY_FAILED",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EAI_AGAIN"
  ];
  return !transientCodes.includes(String(code || ""));
}

async function refreshCookiesFromEnv(userId) {
  const credentials = credentialStore.getJwxtCredentials(userId);
  if (!credentials) {
    console.log("[checker] Cookie 失效，但未配置 JWXT_STUDENT_ID/JWXT_PASSWORD，保持原返回");
    if (userId && credentialStore.hasBoundAccount(userId)) {
      return {
        errorResult: fail("ACCOUNT_RELOGIN_REQUIRED", "校园账号登录已过期，请重新绑定", {
          error: "ACCOUNT_RELOGIN_REQUIRED"
        })
      };
    }
    return null;
  }

  console.log("[checker] 检测到 Cookie 失效，尝试自动刷新");
  const recovery = await recoverCampusSession(userId, "jwxt", async () => {
    let login;
    try {
      login = await httpJwxtLogin(credentials.studentId, credentials.password);
    } catch (err) {
      const classified = classifyJwxtLoginError(err);
      err.code = classified.error;
      throw err;
    }
    const selected = selectJwxtGradeCookies(login.cookies);
    const hasRoute = selected.some(function(c) { return c.name === "route"; });
    const hasJSession = selected.some(function(c) { return c.name === "JSESSIONID"; });
    const hasRememberMe = selected.some(function(c) { return c.name === "rememberMe"; });
    if (!hasRoute || !hasJSession || !hasRememberMe) {
      console.log("[checker] 自动刷新失败：未获取完整 route/JSESSIONID/rememberMe Cookie");
      credentialStore.updateBoundAccountStatus(userId, "JWXT_SSO_FAILED", { clearLastJwxtLoginAt: true });
      const err = new Error("Incomplete JWXT session cookies");
      err.code = "JWXT_SSO_FAILED";
      throw err;
    }
    writeCookies(selected, userId);
    credentialStore.updateBoundAccountStatus(userId, "COOKIE_VALID", { lastJwxtLoginAt: new Date().toISOString() });
    console.log("[checker] 自动刷新成功，已更新 cookies.json（未打印 Cookie 值）");
    return selected;
  });

  if (!recovery.success) {
    console.log("[checker] 自动刷新失败：" + recovery.causeCode);
    credentialStore.updateBoundAccountStatus(userId, recovery.causeCode, { clearLastJwxtLoginAt: true });
    if (!recoveryNeedsAccountRelogin(recovery.causeCode)) {
      return {
        errorResult: fail(recovery.causeCode, "校园账号自动登录暂时失败，请稍后重试", {
          error: recovery.causeCode,
          retryAfterSeconds: recovery.retryAfterSeconds
        })
      };
    }
    return {
      errorResult: fail("ACCOUNT_RELOGIN_REQUIRED", recovery.message, {
        error: "ACCOUNT_RELOGIN_REQUIRED",
        causeCode: recovery.causeCode,
        retryAfterSeconds: recovery.retryAfterSeconds
      })
    };
  }
  return recovery.value;
}

async function executeCheck(cookies, activeStorage) {
  activeStorage = activeStorage || storage;
  if (!cookies) return fail("login_required", "Run: npm run login or POST /upload-cookies");
  const cs = buildCookieHeader(cookies, "newjwc.tyust.edu.cn");
  if (!cs) return fail("login_required", "Missing JWXT session cookie. Upload via POST /upload-cookies");
  try {
    var initResp = await axios.get("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",{headers:{"Cookie":cs},maxRedirects:0,validateStatus:s=>true,timeout:10000}).catch(function(err){ return { status: 0, data: "", _error: err.message }; });
    var initClass = initResp._error ? { status: "jwxt_unavailable", message: initResp._error } : classifyResponse(initResp);
    if (initClass) return fail(initClass.status, initClass.message, { httpStatus: initResp.status });
    var allGrades=[];
    var termResults = await mapWithConcurrency(ALL_TERMS, gradeQueryConcurrency(), async function(t) {
      console.log("[checker] querying grades xnm=" + t.xnm + " xqm=" + t.xqm);
      try{
        var resp=await axios.post(
          "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query",
          new URLSearchParams({xnm:t.xnm,xqm:t.xqm,page:"1",rows:"50"}).toString(),
          {headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":cs,"Referer":"https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default"},maxRedirects:0,validateStatus:function(s){return true;},timeout:30000}
        );
        var respClass = classifyResponse(resp);
        if(respClass) return { errorResult: fail(respClass.status, respClass.message, { httpStatus: resp.status, term: t }) };
        var data=resp.data;
        var grades=[];
        if(Array.isArray(data))grades=data;
        else if(data.items)grades=data.items;
        else if(data.rows)grades=data.rows;
        else return { errorResult: fail("query_error", "Unexpected grade response format", { term: t }) };
        console.log("[checker] term " + t.xnm + "-" + t.xqm + " count=" + grades.length);
        return { grades: grades.map(function(grade) { return attachTermToGrade(grade, t); }) };
      }catch(e){
        if (isJwxtUnavailableError(e)) return { errorResult: fail("jwxt_unavailable", e.message, { term: t }) };
        return { errorResult: fail("query_error", e.message, { term: t }) };
      }
    });
    for(var i=0;i<termResults.length;i++){
      if (termResults[i].errorResult) return termResults[i].errorResult;
      allGrades = allGrades.concat(termResults[i].grades || []);
    }
    if(!allGrades.length)return{success:true,cookieStatus:"cookie_valid",gradesCount:0,added:[],changed:[],changeCount:0,grades:[]};
    var diff=activeStorage.diffGrades(allGrades);
    console.log("[diff] checker added array=" + Array.isArray(diff.added) + " changed array=" + Array.isArray(diff.changed));
    console.log("[diff] checker added=" + (diff.added || []).length + " changed=" + (diff.changed || []).length);
    activeStorage.mergeGrades(allGrades);
    var xgCandidates = activeStorage.getXgUnmatchedCandidates ? activeStorage.getXgUnmatchedCandidates() : [];
    if (xgCandidates.length && activeStorage.mergeXgFallbackGrades) {
      var rematch = activeStorage.mergeXgFallbackGrades(xgCandidates);
      gradeCheckLog("xg-candidate-rematch", {
        matched: rematch.stats.matched,
        remaining: rematch.stats.candidates
      });
    }
    var changeRecords = buildGradeChangeRecords(diff);
    console.log("[changes] checker records=" + changeRecords.length);
    activeStorage.addGradeChanges(changeRecords);
    activeStorage.updateLastRun();
    return{success:true,cookieStatus:"cookie_valid",gradesCount:allGrades.length,added:diff.added.map(function(g){return{kcmc:g.KCMC||g.kcmc,cj:g.CJ||g.cj,xnm:g.XNM||g.xnm,xqm:g.XQM||g.xqm};}),changed:diff.changed,changeCount:changeRecords.length,grades:[]};
  }catch(err){
    return fail("query_error", err.message);
  }
}

async function validateJwxtSessionForUser(userId) {
  const cookies = loadCookies(userId);
  if (!cookies) return { valid: false, shouldRecover: true, error: "login_required" };
  const cookieHeader = buildCookieHeader(cookies, "newjwc.tyust.edu.cn");
  if (!cookieHeader) return { valid: false, shouldRecover: true, error: "login_required" };

  try {
    const response = await axios.get(
      "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",
      {
        headers: { Cookie: cookieHeader },
        maxRedirects: 0,
        validateStatus: status => true,
        timeout: 10000
      }
    );
    const classified = classifyResponse(response);
    if (!classified) return { valid: true, shouldRecover: false, error: null };
    return {
      valid: false,
      shouldRecover: classified.status === "cookie_expired" || classified.status === "login_required",
      error: classified.status
    };
  } catch (err) {
    return {
      valid: false,
      shouldRecover: false,
      error: isJwxtUnavailableError(err) ? "JWXT_UNAVAILABLE" : "JWXT_TIMEOUT"
    };
  }
}

function xgErrorResult(err) {
  const code = err && err.code ? err.code : "XG_SCORE_QUERY_FAILED";
  const message = code === "ACCOUNT_RELOGIN_REQUIRED" || code === "CAMPUS_LOGIN_REQUIRED" || code === "XG_LOGIN_REQUIRED"
    ? "校园账号登录已过期，请重新绑定"
    : "暂时无法同步成绩，请稍后再试";
  return fail(code, message, {
    error: code,
    source: "xg",
    causeCode: err && err.causeCode ? err.causeCode : null,
    retryAfterSeconds: err && err.retryAfterSeconds ? err.retryAfterSeconds : null
  });
}

function gradeUnavailableResult(jwxtResult, xgResult) {
  const jwxtCode = String((jwxtResult && (jwxtResult.error || jwxtResult.cookieStatus)) || "");
  const xgCode = String((xgResult && (xgResult.error || xgResult.cookieStatus)) || "");
  const loginCodes = ["ACCOUNT_RELOGIN_REQUIRED", "CAMPUS_LOGIN_REQUIRED", "XG_LOGIN_REQUIRED", "LOGIN_REQUIRED", "login_required", "COOKIE_EXPIRED", "cookie_expired"];
  if (jwxtCode === "ACCOUNT_RELOGIN_REQUIRED" || xgCode === "ACCOUNT_RELOGIN_REQUIRED" || (loginCodes.includes(xgCode) && (loginCodes.includes(jwxtCode) || !jwxtCode))) {
    return fail("ACCOUNT_RELOGIN_REQUIRED", "校园账号登录已过期，请重新绑定", {
      error: "ACCOUNT_RELOGIN_REQUIRED",
      jwxtError: jwxtCode || null,
      xgError: xgCode || null
    });
  }
  return fail("GRADE_QUERY_UNAVAILABLE", "成绩系统暂时不可用，请稍后再试", {
    error: "GRADE_QUERY_UNAVAILABLE",
    jwxtError: jwxtCode || null,
    xgError: xgCode || null
  });
}

function gradeCheckLog(step, fields) {
  const suffix = Object.keys(fields || {})
    .map(key => key + "=" + fields[key])
    .join(" ");
  console.log("[grade-check] step=" + step + (suffix ? " " + suffix : ""));
}

function gradeChannelMode() {
  const mode = String(process.env.GRADE_CHANNEL_MODE || "auto").trim().toLowerCase();
  return ["auto", "jwxt", "xg"].includes(mode) ? mode : "auto";
}

function xgTermParts(term) {
  const text = String(term || "");
  const match = text.match(/(\d{4})-(\d{4})学年第(\d)学期/);
  if (!match) return { xnm: "", xqm: "" };
  return {
    xnm: match[1],
    xqm: match[3] === "1" ? "3" : (match[3] === "2" ? "12" : match[3])
  };
}

function normalizeXgGrade(item) {
  const termParts = xgTermParts(item.term);
  return {
    studentId: item.studentId || "",
    name: item.name || "",
    courseName: item.courseName || "",
    courseType: item.courseType || "",
    score: item.score || "",
    credit: item.credit || "",
    term: item.term || "",
    source: "xg",
    xh: item.studentId || "",
    xm: item.name || "",
    kcmc: item.courseName || "",
    KCMC: item.courseName || "",
    kcxz: item.courseType || "",
    KCXZ: item.courseType || "",
    cj: item.score || "",
    CJ: item.score || "",
    xf: item.credit || "",
    XF: item.credit || "",
    xnm: termParts.xnm,
    XNM: termParts.xnm,
    xqm: termParts.xqm,
    XQM: termParts.xqm
  };
}

async function executeXgCheck(activeStorage, userId, reason) {
  activeStorage = activeStorage || storage;

  try {
    gradeCheckLog("try-xg", { userScope: userId ? "user" : "legacy", reason: reason || "JWXT_FAILED" });
    const recovery = await recoverCampusSession(userId, "xg", () => ensureXgScoreSession(userId, activeStorage));
    if (!recovery.success) {
      const err = new Error(recovery.message);
      err.code = recoveryNeedsAccountRelogin(recovery.causeCode) ? recovery.error : recovery.causeCode;
      err.causeCode = recovery.causeCode;
      err.retryAfterSeconds = recovery.retryAfterSeconds;
      throw err;
    }
    const session = recovery.value;
    gradeCheckLog("xg-session-ready", { fromCache: Boolean(session.fromCache), cookieLength: String(session.cookies || "").length });
    let scores;
    if (Array.isArray(session.grades)) {
      scores = session.grades;
      gradeCheckLog("use-xg-session-grades", { count: scores.length });
    } else {
      gradeCheckLog("query-xg-scores", { reason: "session-has-no-grades" });
      scores = await queryXgScores({
        scoreUrl: session.scoreUrl,
        cookies: session.cookies
      });
    }
    const allGrades = scores.map(normalizeXgGrade);
    gradeCheckLog("xg-success", { count: allGrades.length });
    const fallbackMerge = activeStorage.mergeXgFallbackGrades(allGrades);
    console.log("[diff] xg added=0 changed=0 mode=fallback");
    gradeCheckLog("xg-fallback-merge", {
      matched: fallbackMerge.stats.matched,
      candidates: fallbackMerge.stats.candidates,
      final: fallbackMerge.stats.final
    });
    activeStorage.updateLastRun();
    return {
      success: true,
      cookieStatus: "xg_valid",
      gradeSource: "xg",
      source: "xg",
      gradesCount: allGrades.length,
      matchedCount: fallbackMerge.stats.matched,
      xgUnmatchedCandidateCount: fallbackMerge.stats.candidates,
      added: [],
      changed: [],
      changeCount: 0,
      grades: []
    };
  } catch (err) {
    const code = (err && err.code) || "XG_SCORE_QUERY_FAILED";
    const message = code === "ACCOUNT_RELOGIN_REQUIRED" || code === "CAMPUS_LOGIN_REQUIRED" || code === "XG_LOGIN_REQUIRED" ? "login_required" : "sync_unavailable";
    gradeCheckLog("xg-failed", { code, message });
    return xgErrorResult(err);
  }
}

function shouldPreferXgError(xgResult, jwxtResult) {
  if (!xgResult || xgResult.success) return false;
  const xgCode = String(xgResult.error || xgResult.cookieStatus || "");
  const jwxtCode = String(jwxtResult && (jwxtResult.error || jwxtResult.cookieStatus) || "");
  if (xgCode === "ACCOUNT_RELOGIN_REQUIRED") return true;
  if (xgCode === "XG_LOGIN_REQUIRED") return jwxtCode === "login_required" || jwxtCode === "LOGIN_REQUIRED" || jwxtCode === "cookie_expired";
  return jwxtCode === "login_required" || jwxtCode === "LOGIN_REQUIRED";
}

async function tryJwxtCheckForUser(userId, userStorage) {
  gradeCheckLog("try-jwxt", { userScope: userId ? "user" : "legacy" });
  const cookies = loadCookies(userId);
  const first = await executeCheck(cookies, userStorage);
  if (first && first.success) {
    first.gradeSource = "jwxt";
    first.source = "jwxt";
    gradeCheckLog("jwxt-success", { count: first.gradesCount || 0 });
    return first;
  }

  if (!shouldAttemptCookieRefresh(first, userId)) {
    gradeCheckLog("jwxt-failed", { code: first && (first.error || first.cookieStatus) || "JWXT_FAILED" });
    return first;
  }

  const refreshedCookies = await refreshCookiesFromEnv(userId);
  if (refreshedCookies && refreshedCookies.errorResult) {
    gradeCheckLog("jwxt-failed", { code: refreshedCookies.errorResult.error || refreshedCookies.errorResult.cookieStatus || "JWXT_REFRESH_FAILED" });
    return refreshedCookies.errorResult;
  }
  if (!refreshedCookies) {
    gradeCheckLog("jwxt-failed", { code: first && (first.error || first.cookieStatus) || "JWXT_REFRESH_SKIPPED" });
    return first;
  }

  const retry = await executeCheck(refreshedCookies, userStorage);
  if (retry.success) {
    retry.cookieStatus = "cookie_valid";
    retry.gradeSource = "jwxt";
    retry.source = "jwxt";
    gradeCheckLog("jwxt-success", { count: retry.gradesCount || 0 });
    return retry;
  }
  const code = isCookieExpiredResult(retry) ? "cookie_expired" : (retry.error || retry.cookieStatus || "JWXT_FAILED");
  gradeCheckLog("jwxt-failed", { code });
  if (isCookieExpiredResult(retry)) return fail("cookie_expired", retry.message || "JWXT cookie refresh retry failed");
  return retry;
}

async function runCycle() {
  gradeCheckLog("start", { userScope: "legacy" });
  const configuredMode = gradeChannelMode();
  const mode = configuredMode === "xg" ? "auto" : configuredMode;
  gradeCheckLog("channel-mode", configuredMode === "xg" ? { mode, ignored: "xg-for-legacy" } : { mode });

  const first = await tryJwxtCheckForUser(null, storage);
  if (first && first.success) return first;
  if (mode === "jwxt") return first;

  const xgReason = first && (first.error || first.cookieStatus) || "JWXT_FAILED";
  const xgResult = await executeXgCheck(storage, null, xgReason);
  if (xgResult && xgResult.success) return xgResult;

  const result = gradeUnavailableResult(first, xgResult);
  gradeCheckLog("failed", { code: result.error || result.cookieStatus || "GRADE_QUERY_UNAVAILABLE" });
  return result;
}

async function runCycleForUser(userId) {
  gradeCheckLog("start", { userScope: "user" });
  const userStorage = createStorageForUser(userId);
  const hasCampusAccount = Boolean(credentialStore.getJwxtCredentials(userId));
  gradeCheckLog("campus-account", { exists: hasCampusAccount });
  const mode = gradeChannelMode();
  gradeCheckLog("channel-mode", { mode });

  if (mode === "xg") {
    gradeCheckLog("skip-jwxt", { reason: "forced-xg-test" });
    return executeXgCheck(userStorage, userId, "forced-xg-test");
  }

  const jwxtResult = await tryJwxtCheckForUser(userId, userStorage);
  if (jwxtResult && jwxtResult.success) return jwxtResult;
  if (jwxtResult && (jwxtResult.error === "ACCOUNT_RELOGIN_REQUIRED" || jwxtResult.cookieStatus === "ACCOUNT_RELOGIN_REQUIRED")) return jwxtResult;
  if (mode === "jwxt") return jwxtResult;

  const xgReason = jwxtResult && (jwxtResult.error || jwxtResult.cookieStatus) || "JWXT_FAILED";
  const xgResult = await executeXgCheck(userStorage, userId, xgReason);
  if (xgResult && xgResult.success) return xgResult;

  const result = gradeUnavailableResult(jwxtResult, xgResult);
  gradeCheckLog("failed", { code: result.error || result.cookieStatus || "GRADE_QUERY_UNAVAILABLE" });
  return result;
}

module.exports = {
  runCycle,
  runCycleForUser,
  loadCookies,
  writeCookies,
  deleteCookies,
  refreshCookiesFromEnv,
  validateJwxtSessionForUser,
  _performance: {
    mapWithConcurrency,
    gradeQueryConcurrency
  }
};
