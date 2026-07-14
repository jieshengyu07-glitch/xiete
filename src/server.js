const express = require("express");
const crypto = require("crypto");
const { runCycle, runCycleForUser, loadCookies, writeCookies, deleteCookies } = require("./checker");
const axios = require("axios");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");
const { httpJwxtLogin, httpPortalLogin, continueJwxtSso } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");
const auth = require("./middleware/auth");
const { signToken, verifyToken } = require("./utils/jwt");
const courseRatingStore = require("./rating/courseRatingStore");
const { safeUserId } = require("./services/userPaths");
const { classifyJwxtLoginError } = require("./services/jwxtLoginError");
const { currentTermInfo, loadConfiguredTerm } = require("./timetable/calendar");
const { syncTimetableForUser, parseClassroom } = require("./timetable/sync");
const { createCaptchaSession, loginWithCaptcha, clearCaptchaSessionsForUser } = require("./login/captchaSession");

const app = express();
const PORT = process.env.PORT || 3456;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

app.use(express.json({ limit: "1mb" }));

function requestStorage(req) {
  return req.userId ? storage.createStorageForUser(req.userId) : storage;
}

function ensureValidScope(req, res) {
  if (!req.userId) {
    res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "Missing authorization token" });
    return false;
  }
  return true;
}

function logUserScope(req, label) {
  console.log("[user-scope] " + label + " scope=" + (req.userId ? "user" : "legacy"));
}

function safeUserHash(userId) {
  if (!userId) return "legacy";
  return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 10);
}

function hasJwxtSessionCookie(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  return Boolean(list.find(x => x.name === "JSESSIONID" && String(x.domain || "").includes("newjwc")));
}

function publicJwxtStatus(bound, cookieValid, accountMeta, credentials) {
  if (!bound) return "LOGIN_REQUIRED";
  if (cookieValid) return "OK";
  if (!credentials) return "LOGIN_FAILED";
  const last = String((accountMeta && (accountMeta.jwxtStatus || accountMeta.lastJwxtStatus)) || "");
  if (last === "OK" || last === "COOKIE_VALID") return "COOKIE_EXPIRED";
  if (last === "JWXT_CAPTCHA_REQUIRED" || last === "CAPTCHA_REQUIRED") return "CAPTCHA_REQUIRED";
  if (last === "JWXT_SSO_FAILED" || last === "SSO_FAILED") return "SSO_FAILED";
  if (last === "JWXT_UNAVAILABLE" || last === "UNAVAILABLE") return "UNAVAILABLE";
  if (last === "JWXT_TIMEOUT" || last === "TIMEOUT") return "TIMEOUT";
  if (last === "JWXT_LOGIN_FAILED" || last === "LOGIN_FAILED") return "LOGIN_FAILED";
  if (last === "COOKIE_EXPIRED" || !last) return "COOKIE_EXPIRED";
  return "LOGIN_FAILED";
}

function legacyCookieStatus(jwxtStatus) {
  if (jwxtStatus === "LOGIN_REQUIRED") return "login_required";
  if (jwxtStatus === "OK") return "cookie_valid";
  if (jwxtStatus === "CAPTCHA_REQUIRED") return "JWXT_CAPTCHA_REQUIRED";
  if (jwxtStatus === "COOKIE_EXPIRED") return "cookie_expired";
  if (jwxtStatus === "SSO_FAILED") return "JWXT_SSO_FAILED";
  if (jwxtStatus === "UNAVAILABLE") return "JWXT_UNAVAILABLE";
  if (jwxtStatus === "TIMEOUT") return "JWXT_TIMEOUT";
  return "login_failed";
}

function jwxtPublicStatusFromError(code) {
  if (code === "JWXT_SSO_FAILED") return "SSO_FAILED";
  if (code === "JWXT_UNAVAILABLE") return "UNAVAILABLE";
  if (code === "JWXT_TIMEOUT") return "TIMEOUT";
  if (code === "JWXT_CAPTCHA_REQUIRED") return "CAPTCHA_REQUIRED";
  if (code === "JWXT_INVALID_CREDENTIALS") return "LOGIN_FAILED";
  return "LOGIN_FAILED";
}

function bindWarningResponse(jwxtStatus) {
  return {
    success: true,
    warning: true,
    code: 0,
    bound: true,
    verified: false,
    portalAuthStatus: "OK",
    jwxtStatus,
    message: "教务账号已验证并保存，但教务系统暂时不可用，课表和成绩稍后可重试刷新。"
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeJwxtApiCode(value) {
  const code = String(value || "");
  if (code.startsWith("XG_")) return code;
  if (code.startsWith("CAMPUS_")) return code;
  if (code === "GRADE_QUERY_UNAVAILABLE") return "GRADE_QUERY_UNAVAILABLE";
  if (code === "jwxt_unavailable") return "JWXT_UNAVAILABLE";
  if (code === "jwxt_timeout") return "JWXT_TIMEOUT";
  if (code === "cookie_expired") return "COOKIE_EXPIRED";
  if (code === "login_required") return "LOGIN_REQUIRED";
  if (code === "query_error") return "JWXT_LOGIN_FAILED";
  if (code.startsWith("JWXT_") || code === "LOGIN_REQUIRED" || code === "COOKIE_EXPIRED") return code;
  return classifyJwxtLoginError(code).error;
}

function statusFromApiCode(code) {
  if (String(code || "").startsWith("XG_")) return "LOGIN_FAILED";
  if (String(code || "").startsWith("CAMPUS_")) return "LOGIN_REQUIRED";
  if (code === "GRADE_QUERY_UNAVAILABLE") return "UNAVAILABLE";
  if (code === "JWXT_UNAVAILABLE") return "UNAVAILABLE";
  if (code === "JWXT_TIMEOUT") return "TIMEOUT";
  if (code === "JWXT_SSO_FAILED") return "SSO_FAILED";
  if (code === "JWXT_CAPTCHA_REQUIRED") return "CAPTCHA_REQUIRED";
  if (code === "COOKIE_EXPIRED") return "COOKIE_EXPIRED";
  if (code === "LOGIN_REQUIRED") return "LOGIN_REQUIRED";
  return "LOGIN_FAILED";
}

function isRetryCooledDown(accountMeta) {
  const lastError = normalizeJwxtApiCode(accountMeta && accountMeta.lastJwxtError);
  if (lastError === "JWXT_CAPTCHA_REQUIRED") {
    return { cooledDown: true, error: lastError, message: "教务系统需要验证码，请输入验证码完成验证" };
  }

  const minutes = lastError === "JWXT_UNAVAILABLE" ? 5 : (lastError === "JWXT_TIMEOUT" ? 3 : 0);
  const failedAt = accountMeta && accountMeta.lastFailedSyncAt ? new Date(accountMeta.lastFailedSyncAt).getTime() : 0;
  if (!minutes || !failedAt) return { cooledDown: false };

  const waitMs = minutes * 60 * 1000;
  const elapsed = Date.now() - failedAt;
  if (elapsed >= 0 && elapsed < waitMs) {
    return {
      cooledDown: true,
      error: lastError,
      message: lastError === "JWXT_TIMEOUT" ? "教务系统响应超时，请稍后再试" : "教务系统暂时不可用，请稍后再试",
      retryAfterSeconds: Math.ceil((waitMs - elapsed) / 1000)
    };
  }
  return { cooledDown: false };
}

function gradeChannelMode() {
  const mode = String(process.env.GRADE_CHANNEL_MODE || "auto").trim().toLowerCase();
  return ["auto", "jwxt", "xg"].includes(mode) ? mode : "auto";
}

function recordJwxtSuccess(userId, activeStorage, kind) {
  const at = nowIso();
  if (activeStorage && typeof activeStorage.setSyncSuccess === "function") activeStorage.setSyncSuccess(kind, at);
  if (userId) {
    credentialStore.updateBoundAccountStatus(userId, "OK", {
      lastSuccessfulSyncAt: at,
      lastJwxtError: null,
      lastJwxtErrorMessage: null
    });
  }
}

function recordJwxtFailure(userId, activeStorage, kind, code, message) {
  const normalized = normalizeJwxtApiCode(code);
  const at = nowIso();
  if (activeStorage && typeof activeStorage.setSyncFailure === "function") activeStorage.setSyncFailure(kind, normalized, message, at);
  if (userId) {
    credentialStore.updateBoundAccountStatus(userId, statusFromApiCode(normalized), {
      lastFailedSyncAt: at,
      lastJwxtError: normalized,
      lastJwxtErrorMessage: message || ""
    });
  }
}

function cacheWarningMessage(kind, hasCache, code) {
  if (kind === "timetable") {
    return hasCache ? "教务系统暂时不可用，当前显示上次同步课表" : "暂无课表缓存，请稍后重试或在教务系统恢复后刷新。";
  }
  if (code === "XG_LOGIN_REQUIRED") {
    return hasCache ? "成绩登录已失效，当前显示上次查询成绩" : "成绩登录已失效，请重新登录";
  }
  if (code === "CAMPUS_LOGIN_REQUIRED") {
    return hasCache ? "成绩登录已失效，当前显示上次查询成绩" : "成绩登录已失效，请重新登录";
  }
  if (code === "GRADE_QUERY_UNAVAILABLE") {
    return hasCache ? "成绩系统暂时不可用，当前显示上次查询成绩" : "成绩系统暂时不可用，请稍后再试";
  }
  return hasCache ? "教务系统暂时不可用，当前显示上次查询成绩" : "暂无成绩缓存，教务系统恢复后可重新检查。";
}

function safeUrlHostPath(value) {
  if (!value) return "unknown";
  try {
    const parsed = new URL(String(value));
    return parsed.host + parsed.pathname;
  } catch (err) {
    return "unknown";
  }
}

function shortMessage(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 120);
}

function bindFailureDetails(err, fallback) {
  const response = err && err.response;
  const config = err && err.config;
  return {
    errorType: String((err && (err.errorType || err.code || err.name)) || (fallback && fallback.errorType) || "unknown"),
    step: String((err && (err.step || err.phase)) || (fallback && fallback.step) || "unknown"),
    httpStatus: String((err && (err.httpStatus || err.status)) || (response && response.status) || (fallback && fallback.httpStatus) || "unknown"),
    finalUrl: safeUrlHostPath((err && (err.finalUrl || err.url)) || (config && config.url) || (fallback && fallback.finalUrl)),
    message: shortMessage((err && err.message) || (fallback && fallback.message) || "")
  };
}

function logBindVerifyFailed(err, fallback) {
  const details = bindFailureDetails(err, fallback);
  console.log("[bind] jwxt verify failed errorType=" + details.errorType +
    " step=" + details.step +
    " httpStatus=" + details.httpStatus +
    " finalUrl=" + details.finalUrl +
    " message=" + details.message);
}

function isJwglxtPath(cookiePath) {
  return cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
}

function selectJwxtGradeCookies(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const route = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/");
  const jsession = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path));
  const rememberMe = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path));
  return [route, jsession, rememberMe].filter(Boolean);
}

async function resolveWechatOpenid(code) {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;

  if (!appid || !secret) {
    const safeCode = safeUserId(code) || "openid";
    return "dev_" + safeCode;
  }

  if (!code) {
    throw new Error("Missing wx.login code");
  }

  const resp = await axios.get("https://api.weixin.qq.com/sns/jscode2session", {
    params: {
      appid,
      secret,
      js_code: code,
      grant_type: "authorization_code"
    },
    timeout: 10000
  });

  const data = resp.data || {};
  if (!data.openid) {
    throw new Error(data.errmsg || "Failed to resolve openid");
  }
  return data.openid;
}

// POST /auth/wechat-login
app.post("/auth/wechat-login", async (req, res) => {
  try {
    const code = req.body && req.body.code;
    const userId = await resolveWechatOpenid(code);
    const token = signToken({ userId });
    console.log("[auth] wechat-login success");
    res.json({
      code: 0,
      token,
      user: {
        id: userId,
        nickname: ""
      }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: "WECHAT_LOGIN_FAILED",
      message: err.message
    });
  }
});

function ratingApiOk(res, data) {
  res.json({ code: 0, message: "success", data });
}

function ratingApiError(res, status, error, message) {
  res.status(status).json({ code: status, error, message });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

function optionalRatingUserId(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload && payload.userId ? payload.userId : null;
  } catch (err) {
    return null;
  }
}

function requireRatingAuth(req, res, next) {
  const userId = optionalRatingUserId(req);
  if (!userId) {
    ratingApiError(res, 401, "UNAUTHORIZED", "请先登录");
    return;
  }
  req.userId = userId;
  next();
}

function ratingErrorStatus(code) {
  if (code === "COURSE_NOT_FOUND" || code === "REVIEW_NOT_FOUND") return 404;
  if (code === "INVALID_COURSE_INPUT" || code === "INVALID_REVIEW_INPUT") return 400;
  return 500;
}

function sendRatingStoreError(res, err) {
  const code = err && err.code ? err.code : "RATING_API_FAILED";
  ratingApiError(res, ratingErrorStatus(code), code, err && err.message ? err.message : "课程评分服务暂时不可用");
}

app.get("/api/courses/search", (req, res) => {
  try {
    const keyword = req.query && req.query.keyword ? String(req.query.keyword) : "";
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 20;
    ratingApiOk(res, { courses: courseRatingStore.searchCourses(keyword, limit) });
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.get("/api/courses/hot", (req, res) => {
  try {
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 10;
    ratingApiOk(res, { reviews: courseRatingStore.hotCourseReviews(limit) });
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.post("/api/courses", requireRatingAuth, (req, res) => {
  try {
    ratingApiOk(res, courseRatingStore.addCourse(req.body || {}, req.userId));
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.get("/api/courses/:id/reviews", (req, res) => {
  try {
    const sort = req.query && req.query.sort ? String(req.query.sort) : "hot";
    ratingApiOk(res, {
      reviews: courseRatingStore.listReviews(req.params.id, sort, optionalRatingUserId(req))
    });
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.post("/api/courses/:id/reviews", requireRatingAuth, (req, res) => {
  try {
    ratingApiOk(res, courseRatingStore.upsertReview(req.params.id, req.userId, req.body || {}));
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.get("/api/courses/:id", (req, res) => {
  try {
    const result = courseRatingStore.getCourse(req.params.id, optionalRatingUserId(req));
    if (!result) return ratingApiError(res, 404, "COURSE_NOT_FOUND", "课程不存在");
    ratingApiOk(res, result);
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.post("/api/course-reviews/:id/like", requireRatingAuth, (req, res) => {
  try {
    ratingApiOk(res, courseRatingStore.toggleLike(req.params.id, req.userId));
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.get("/api/rank/courses", (req, res) => {
  try {
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 10;
    ratingApiOk(res, { courses: courseRatingStore.rankCourses(limit) });
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

app.get("/api/home", (req, res) => {
  try {
    ratingApiOk(res, courseRatingStore.home());
  } catch (err) {
    sendRatingStoreError(res, err);
  }
});

// Background scheduler
const scheduler = new Scheduler(async () => {
  const r = await runCycle();
  if (r.success) console.log("[bg] " + r.gradesCount + " grades" + (r.added.length ? " +" + r.added.length : "") + (r.changed.length ? " ~" + r.changed.length : ""));
  else console.log("[bg] " + (r.error || r.message));
});
if (String(process.env.DISABLE_SCHEDULER || "") === "1") {
  console.log("[bg] scheduler disabled by DISABLE_SCHEDULER=1");
} else {
  scheduler.start();
}

// GET /status
function buildUnevaluatedCourses(activeStorage) {
  return activeStorage.getGrades()
    .filter(g => String(g.CJ || g.cj || "") === "未评价")
    .map(g => {
      const xnm = g.XNM || g.xnm || "";
      const xqm = g.XQM || g.xqm || "";
      return {
        kcmc: g.KCMC || g.kcmc || "",
        xnm,
        xqm,
        termName: termLabel(xnm, xqm)
      };
    });
}

function xgScoreConfigured(activeStorage) {
  return Boolean(activeStorage && typeof activeStorage.hasXgSession === "function" && activeStorage.hasXgSession());
}

function detectGradeSource(activeStorage, hasXg, hasJwxt) {
  const grades = activeStorage.getGrades();
  if (grades.some(g => String(g.source || "") === "xg")) return "xg";
  if (hasXg) return "xg";
  if (grades.length || hasJwxt) return "jwxt";
  return "none";
}

function publicCampusLoginStatus(bound, jwxtStatus) {
  if (!bound) return "missing";
  const status = String(jwxtStatus || "").toUpperCase();
  if (status === "OK") return "valid";
  if (status === "UNAVAILABLE" || status === "TIMEOUT") return "valid";
  if (status === "LOGIN_REQUIRED" || status === "LOGIN_FAILED" || status === "COOKIE_EXPIRED" || status === "CAPTCHA_REQUIRED" || status === "SSO_FAILED") return "expired";
  return "valid";
}

function publicGradeQueryStatus(activeStorage, campusLoginStatus) {
  const meta = activeStorage.getSyncMeta ? activeStorage.getSyncMeta("grades") : {};
  const code = normalizeJwxtApiCode(meta && meta.lastError);
  if (campusLoginStatus === "missing" || campusLoginStatus === "expired" || code === "XG_LOGIN_REQUIRED" || code === "CAMPUS_LOGIN_REQUIRED") {
    return "login_required";
  }
  if (code === "JWXT_UNAVAILABLE" || code === "JWXT_TIMEOUT" || code === "XG_SCORE_QUERY_FAILED") return "unavailable";
  return "ready";
}

app.get("/status", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /status");
  const activeStorage = requestStorage(req);
  const cookies = loadCookies(req.userId);
  const valid = hasJwxtSessionCookie(cookies);
  const accountMeta = req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null;
  const credentials = req.userId ? credentialStore.getJwxtCredentials(req.userId) : credentialStore.getJwxtCredentials();
  const bound = req.userId ? Boolean(accountMeta) : Boolean(credentials);
  const jwxtStatus = publicJwxtStatus(bound, valid, accountMeta, credentials);
  const unevaluatedCourses = buildUnevaluatedCourses(activeStorage);
  const hasXg = xgScoreConfigured(activeStorage);
  const gradeSource = detectGradeSource(activeStorage, hasXg, bound || valid);
  const campusLoginStatus = publicCampusLoginStatus(bound, jwxtStatus);
  const gradeQueryStatus = publicGradeQueryStatus(activeStorage, campusLoginStatus);
  let hasTimetable = false;
  try {
    const info = currentTermInfo();
    hasTimetable = activeStorage.getTimetable(info.termYear, info.termSemester).length > 0;
  } catch (err) {}
  res.json({
    status: "running",
    bound,
    campusLoginStatus,
    gradeQueryStatus,
    portalAuthStatus: bound ? ((accountMeta && accountMeta.portalAuthStatus) || (credentials ? "OK" : "FAILED")) : "FAILED",
    jwxtStatus,
    cookieValid: valid,
    cookieStatus: legacyCookieStatus(jwxtStatus),
    xgScoreConfigured: hasXg,
    xgCookieValid: null,
    gradeSource,
    totalGrades: activeStorage.getGrades().length,
    hasTimetable,
    unevaluatedCount: unevaluatedCourses.length,
    unevaluatedCourses,
    lastCheckAt: activeStorage.data?.lastRunAt || null,
    lastSuccessfulSyncAt: accountMeta && accountMeta.lastSuccessfulSyncAt || null,
    lastFailedSyncAt: accountMeta && accountMeta.lastFailedSyncAt || null,
    lastJwxtError: accountMeta && accountMeta.lastJwxtError || null,
    lastJwxtErrorMessage: accountMeta && accountMeta.lastJwxtErrorMessage || null,
    version: "1.0.0",
  });
});

// GET /grades
function schoolYearName(xnm) {
  if (!xnm) return "未知学年";
  var text = String(xnm);
  if (/^\d{4}$/.test(text)) return text + "-" + (Number(text) + 1);
  return text;
}

function termNumber(xqm) {
  var text = String(xqm || "");
  if (text === "12") return 2;
  if (text === "3") return 1;
  var n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function termLabel(xnm, xqm) {
  var text = String(xqm || "");
  var termName = "未知学期";
  if (text === "3") termName = "第1学期";
  else if (text === "12") termName = "第2学期";
  else if (text) termName = text;
  return schoolYearName(xnm) + "学年" + termName;
}

function buildGroupedGrades(grades) {
  var map = {};
  grades.forEach(function(g) {
    var xnm = g.xnm || "";
    var xqm = g.xqm || "";
    var term = g.term || g.termName || "";
    var key = (xnm || xqm) ? xnm + "_" + xqm : (term || "default");
    if (!map[key]) {
      map[key] = { key: key, xnm: xnm, xqm: xqm, termName: term || termLabel(xnm, xqm), grades: [] };
    }
    map[key].grades.push(g);
  });
  return Object.keys(map).map(function(k) { return map[k]; }).sort(function(a, b) {
    var ya = parseInt(a.xnm, 10) || 0;
    var yb = parseInt(b.xnm, 10) || 0;
    if (yb !== ya) return yb - ya;
    return termNumber(b.xqm) - termNumber(a.xqm);
  });
}

function compactGrade(g) {
  const courseName = g.courseName || g.KCMC || g.kcmc || "";
  const score = g.score || g.CJ || g.cj || "";
  const credit = g.credit || g.XF || g.xf || "";
  const courseType = g.courseType || g.KCXZ || g.kcxz || "";
  const term = g.term || g.termName || "";
  return {
    kcmc: courseName,
    cj: score,
    xf: credit,
    xnm: g.XNM || g.xnm || "",
    xqm: g.XQM || g.xqm || "",
    courseName,
    score,
    credit,
    courseType,
    term,
    source: g.source || "jwxt"
  };
}

app.get("/grades", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /grades");
  const activeStorage = requestStorage(req);
  const meta = activeStorage.getSyncMeta ? activeStorage.getSyncMeta("grades") : {};
  const accountMeta = req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null;
  const grades = activeStorage.getGrades().map(compactGrade);
  const warningCode = normalizeJwxtApiCode((meta && meta.lastError) || (accountMeta && accountMeta.lastJwxtError));
  const warning = grades.length > 0 && ["JWXT_UNAVAILABLE", "JWXT_TIMEOUT", "JWXT_SSO_FAILED"].includes(warningCode);
  res.json({
    success: true,
    fromCache: true,
    warning,
    warningCode: warning ? warningCode : null,
    message: warning ? cacheWarningMessage("grades", true, warningCode) : (grades.length ? "" : "暂无成绩缓存，教务系统恢复后可重新检查。"),
    hasGrades: grades.length > 0,
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt || activeStorage.data?.lastRunAt || null,
    lastFailedSyncAt: meta.lastFailedSyncAt || null,
    count: grades.length,
    grades,
    groupedGrades: buildGroupedGrades(grades)
  });
});

// GET /grade-changes
app.get("/grade-changes", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /grade-changes");
  const activeStorage = requestStorage(req);
  const changes = activeStorage.getGradeChanges(20);
  res.json({ count: changes.length, changes });
});

// POST /check
app.post("/check", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "POST /check");
  console.log("[grade-check] step=start userScope=" + (req.userId ? "user" : "legacy"));
  const activeStorage = requestStorage(req);
  const cachedGrades = activeStorage.getGrades();
  const hasCache = cachedGrades.length > 0;
  const channelMode = gradeChannelMode();
  const cooldown = isRetryCooledDown(req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null);
  if (cooldown.cooledDown && channelMode !== "xg") {
    console.log("[grade-check] step=failed code=" + cooldown.error + " reason=cooldown");
    return res.json({
      success: false,
      checked: false,
      error: cooldown.error,
      warning: hasCache,
      fromCache: hasCache,
      hasCache,
      retryAfterSeconds: cooldown.retryAfterSeconds || null,
      message: hasCache ? cacheWarningMessage("grades", true, cooldown.error) : cacheWarningMessage("grades", false, cooldown.error),
      gradesCount: cachedGrades.length,
      added: [],
      changed: [],
      changeCount: 0,
      cookieStatus: cooldown.error
    });
  }
  const r = req.userId ? await runCycleForUser(req.userId) : await runCycle();
  if (r.success) {
    recordJwxtSuccess(req.userId, activeStorage, "grades");
    res.json({ success: true, checked: true, fromCache: false, warning: false, hasCache: true, gradesCount: r.gradesCount, added: r.added, changed: r.changed, changeCount: r.changeCount || 0, error: null, cookieStatus: r.cookieStatus || "cookie_valid", gradeSource: r.gradeSource || r.source || "jwxt" });
  }
  else {
    const classified = classifyJwxtLoginError(r.error || r.message || r);
    const code = normalizeJwxtApiCode(r.error || r.cookieStatus || classified.error);
    const message = r.message || classified.message;
    recordJwxtFailure(req.userId, activeStorage, "grades", code, message);
    res.json({
      success: false,
      checked: false,
      fromCache: hasCache,
      warning: hasCache,
      hasCache,
      gradesCount: cachedGrades.length,
      added: [],
      changed: [],
      changeCount: 0,
      error: code,
      message: hasCache ? cacheWarningMessage("grades", true, code) : cacheWarningMessage("grades", false, code),
      detailMessage: message,
      cookieStatus: code
    });
  }
});

function apiErrorStatus(code) {
  if (String(code || "").startsWith("XG_")) return 400;
  if (code === "LOGIN_REQUIRED" || code === "INVALID_CAPTCHA_LOGIN_INPUT") return 400;
  if (code === "JWXT_CAPTCHA_REQUIRED" || code === "JWXT_CAPTCHA_INVALID") return 400;
  if (code === "JWXT_INVALID_CREDENTIALS" || code === "INVALID_CREDENTIALS" || code === "CAPTCHA_LOGIN_FAILED" || code === "CAPTCHA_SESSION_EXPIRED" || code === "JWXT_CAPTCHA_SESSION_EXPIRED") return 400;
  if (code === "JWXT_SSO_FAILED") return 502;
  if (code === "JWXT_TIMEOUT") return 504;
  if (code === "JWXT_UNAVAILABLE") return 503;
  if (code === "RATE_LIMITED") return 429;
  return 500;
}

// GET /jwxt/captcha-session
app.get("/jwxt/captcha-session", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    const result = await createCaptchaSession(req.userId);
    res.json(result);
  } catch (err) {
    const code = err && err.code ? err.code : "CAPTCHA_SESSION_FAILED";
    res.status(apiErrorStatus(code)).json({
      success: false,
      error: code,
      message: err && err.message ? err.message : "获取验证码失败"
    });
  }
});

// POST /jwxt/login-with-captcha
app.post("/jwxt/login-with-captcha", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    const result = await loginWithCaptcha(req.userId, req.body || {});
    res.json(result);
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    const code = err && err.code ? err.code : classified.error;
    credentialStore.updateBoundAccountStatus(req.userId, code, { clearLastJwxtLoginAt: true });
    res.status(apiErrorStatus(code)).json({
      success: false,
      error: code,
      message: err && err.message ? err.message : classified.message
    });
  }
});

function timetableAppliesToWeek(item, weekNumber) {
  const start = Number(item.weekStart || 1);
  const end = Number(item.weekEnd || start);
  if (weekNumber < start || weekNumber > end) return false;
  if (item.weekType === "ODD") return weekNumber % 2 === 1;
  if (item.weekType === "EVEN") return weekNumber % 2 === 0;
  return true;
}

function compactTimetableItem(item) {
  const parsed = parseClassroom(item.classroomRaw || item.displayLocation || item.displayRoom);
  return {
    id: item.id,
    weekday: item.weekday,
    section: item.section,
    courseName: item.courseName,
    teacherName: item.teacherName || "",
    classroomRaw: item.classroomRaw || "",
    building: parsed.building || item.building || "",
    room: parsed.room || item.room || "",
    displayLocation: parsed.displayLocation,
    displayRoom: item.displayRoom || "",
    weeksRaw: item.weeksRaw || "",
    weekStart: item.weekStart,
    weekEnd: item.weekEnd,
    weekType: item.weekType || "ALL",
    updatedAt: item.updatedAt
  };
}

function fillDaySections(rows) {
  const bySection = {};
  rows.forEach(item => {
    const section = Number(item.section);
    if (!bySection[section]) bySection[section] = [];
    bySection[section].push(compactTimetableItem(item));
  });
  return [1, 2, 3, 4].map(section => ({
    section,
    title: "第" + section + "大节",
    courses: bySection[section] || []
  }));
}

function termRowsForRequest(req) {
  const term = loadConfiguredTerm();
  const rows = requestStorage(req).getTimetable(term.termYear, term.termSemester);
  return { term, rows };
}

function dateParam(req) {
  const value = req.query && req.query.date ? String(req.query.date).trim() : "";
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;
  return value;
}

function timetableDebug(info, totalCached, matchedCount) {
  return {
    date: info.date,
    weekday: info.weekday,
    weekNumber: info.weekNumber,
    weekType: info.weekType,
    totalCached,
    matchedCount
  };
}

function emptyTimetableMessage(rows) {
  return rows.length ? "" : "暂无课表缓存，请稍后重试或在教务系统恢复后刷新。";
}

function sendTermConfigError(res, err) {
  if (err && err.code === "TERM_CONFIG_INVALID") {
    res.status(500).json({
      success: false,
      error: "TERM_CONFIG_INVALID",
      message: err.message
    });
    return true;
  }
  return false;
}

// GET /timetable/config
app.get("/timetable/config", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    const info = currentTermInfo();
    const activeStorage = requestStorage(req);
    const cachedRows = activeStorage.getTimetable(info.termYear, info.termSemester);
    res.json({
      success: true,
      termYear: info.termYear,
      termSemester: info.termSemester,
      date: info.date,
      weekday: info.weekday,
      teachingWeekStartDate: info.teachingWeekStartDate,
      weekNumber: info.weekNumber,
      weekType: info.weekType,
      weekTypeText: info.weekTypeText,
      hasTimetable: cachedRows.length > 0,
      timetableCount: cachedRows.length
    });
  } catch (err) {
    if (sendTermConfigError(res, err)) return;
    res.status(500).json({ success: false, error: "TIMETABLE_CONFIG_FAILED", message: err.message });
  }
});

// GET /timetable/today
app.get("/timetable/today", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  const requestedDate = dateParam(req);
  if (requestedDate === false) {
    return res.status(400).json({ success: false, error: "INVALID_DATE", message: "date must be YYYY-MM-DD" });
  }
  let info;
  try {
    info = currentTermInfo(requestedDate || undefined);
  } catch (err) {
    if (sendTermConfigError(res, err)) return;
    return res.status(500).json({ success: false, error: "TIMETABLE_TODAY_FAILED", message: err.message });
  }
  const { rows } = termRowsForRequest(req);
  const activeStorage = requestStorage(req);
  const meta = activeStorage.getSyncMeta ? activeStorage.getSyncMeta("timetable") : {};
  const accountMeta = req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null;
  const warningCode = normalizeJwxtApiCode((meta && meta.lastError) || (accountMeta && accountMeta.lastJwxtError));
  const warning = rows.length > 0 && ["JWXT_UNAVAILABLE", "JWXT_TIMEOUT", "JWXT_SSO_FAILED"].includes(warningCode);
  const todayRows = rows
    .filter(item => Number(item.weekday) === Number(info.weekday))
    .filter(item => timetableAppliesToWeek(item, info.weekNumber))
    .sort((a, b) => Number(a.section) - Number(b.section));

  res.json({
    success: true,
    fromCache: true,
    warning,
    warningCode: warning ? warningCode : null,
    ...info,
    hasTimetable: rows.length > 0,
    message: warning ? cacheWarningMessage("timetable", true, warningCode) : emptyTimetableMessage(rows),
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt || activeStorage.data?.timetableLastSyncAt || null,
    lastFailedSyncAt: meta.lastFailedSyncAt || null,
    debug: timetableDebug(info, rows.length, todayRows.length),
    sections: fillDaySections(todayRows)
  });
});

// GET /timetable/week
app.get("/timetable/week", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  const requestedDate = dateParam(req);
  if (requestedDate === false) {
    return res.status(400).json({ success: false, error: "INVALID_DATE", message: "date must be YYYY-MM-DD" });
  }
  let info;
  try {
    info = currentTermInfo(requestedDate || undefined);
  } catch (err) {
    if (sendTermConfigError(res, err)) return;
    return res.status(500).json({ success: false, error: "TIMETABLE_WEEK_FAILED", message: err.message });
  }
  const { rows } = termRowsForRequest(req);
  const activeStorage = requestStorage(req);
  const meta = activeStorage.getSyncMeta ? activeStorage.getSyncMeta("timetable") : {};
  const accountMeta = req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null;
  const warningCode = normalizeJwxtApiCode((meta && meta.lastError) || (accountMeta && accountMeta.lastJwxtError));
  const warning = rows.length > 0 && ["JWXT_UNAVAILABLE", "JWXT_TIMEOUT", "JWXT_SSO_FAILED"].includes(warningCode);
  const filtered = rows
    .filter(item => timetableAppliesToWeek(item, info.weekNumber))
    .sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.section) - Number(b.section));

  const days = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({
    weekday,
    sections: fillDaySections(filtered.filter(item => Number(item.weekday) === weekday))
  }));

  res.json({
    success: true,
    fromCache: true,
    warning,
    warningCode: warning ? warningCode : null,
    ...info,
    hasTimetable: rows.length > 0,
    message: warning ? cacheWarningMessage("timetable", true, warningCode) : emptyTimetableMessage(rows),
    lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt || activeStorage.data?.timetableLastSyncAt || null,
    lastFailedSyncAt: meta.lastFailedSyncAt || null,
    debug: timetableDebug(info, rows.length, filtered.length),
    days
  });
});

// POST /timetable/sync
app.post("/timetable/sync", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  const activeStorage = requestStorage(req);
  let configuredTerm;
  try {
    configuredTerm = loadConfiguredTerm();
  } catch (err) {
    if (sendTermConfigError(res, err)) return;
    return res.status(500).json({ success: false, error: "TIMETABLE_CONFIG_FAILED", message: err.message });
  }
  const cachedRows = activeStorage.getTimetable(configuredTerm.termYear, configuredTerm.termSemester);
  const hasCache = cachedRows.length > 0;
  const cooldown = isRetryCooledDown(req.userId ? credentialStore.readBoundAccountMeta(req.userId) : null);
  if (cooldown.cooledDown) {
    return res.json({
      success: false,
      error: cooldown.error,
      warning: hasCache,
      fromCache: hasCache,
      hasCache,
      retryAfterSeconds: cooldown.retryAfterSeconds || null,
      message: hasCache ? cacheWarningMessage("timetable", true, cooldown.error) : cacheWarningMessage("timetable", false, cooldown.error)
    });
  }

  try {
    console.log("[timetable] sync start userHash=" + safeUserHash(req.userId));
    const result = await syncTimetableForUser(req.userId, activeStorage, {
      term: configuredTerm
    });
    if (result && result.success === false) {
      console.log("[timetable] sync empty rawCount=" + result.rawCount);
      if (result.error && result.error !== "TIMETABLE_EMPTY") {
        recordJwxtFailure(req.userId, activeStorage, "timetable", result.error, result.message);
      }
      return res.json(result);
    }
    console.log("[timetable] sync success syncedCount=" + result.syncedCount);
    recordJwxtSuccess(req.userId, activeStorage, "timetable");
    res.json(Object.assign({ warning: false, fromCache: false, hasCache: true }, result));
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    const code = normalizeJwxtApiCode(err && err.code ? err.code : classified.error);
    const message = err && err.message ? err.message : classified.message;
    console.log("[timetable] sync failed code=" + code);
    if (sendTermConfigError(res, err)) return;
    recordJwxtFailure(req.userId, activeStorage, "timetable", code, message);
    res.json({
      success: false,
      error: code,
      warning: hasCache,
      fromCache: hasCache,
      hasCache,
      message: hasCache ? cacheWarningMessage("timetable", true, code) : cacheWarningMessage("timetable", false, code),
      detailMessage: message
    });
  }
});

// POST /bind-account
app.post("/bind-account", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  console.log("[bind] start scope=" + (req.userId ? "user" : "legacy"));
  logUserScope(req, "POST /bind-account");
  const studentId = String((req.body && req.body.studentId) || "").trim();
  const password = String((req.body && req.body.password) || "");

  if (!studentId || !password) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ACCOUNT",
      message: "studentId and password are required"
    });
  }

  let portal;
  try {
    console.log("[bind] verifying portal credentials");
    portal = await httpPortalLogin(studentId, password);
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    console.log("[bind] portal classified error=" + classified.error);

    if (classified.error === "JWXT_INVALID_CREDENTIALS") {
      credentialStore.updateBoundAccountStatus(req.userId, "LOGIN_FAILED", {
        portalAuthStatus: "INVALID_CREDENTIALS",
        clearLastJwxtLoginAt: true
      });
      return res.status(400).json({
        success: false,
        bound: Boolean(credentialStore.readBoundAccountMeta(req.userId)),
        portalAuthStatus: "INVALID_CREDENTIALS",
        jwxtStatus: "LOGIN_FAILED",
        error: "JWXT_INVALID_CREDENTIALS",
        message: classified.message
      });
    }

    if (classified.error === "JWXT_CAPTCHA_REQUIRED") {
      credentialStore.updateBoundAccountStatus(req.userId, "CAPTCHA_REQUIRED", {
        portalAuthStatus: "CAPTCHA_REQUIRED",
        clearLastJwxtLoginAt: true
      });
      return res.status(400).json({
        success: false,
        bound: Boolean(credentialStore.readBoundAccountMeta(req.userId)),
        portalAuthStatus: "CAPTCHA_REQUIRED",
        jwxtStatus: "CAPTCHA_REQUIRED",
        error: "JWXT_CAPTCHA_REQUIRED",
        message: classified.message
      });
    }

    return res.status(apiErrorStatus(classified.error)).json({
      success: false,
      bound: Boolean(credentialStore.readBoundAccountMeta(req.userId)),
      portalAuthStatus: "FAILED",
      jwxtStatus: "LOGIN_FAILED",
      error: classified.error,
      message: classified.message
    });
  }

  credentialStore.saveBoundAccount(studentId, password, req.userId);
  credentialStore.updateBoundAccountStatus(req.userId, "COOKIE_EXPIRED", {
    portalAuthStatus: "OK",
    clearLastJwxtLoginAt: true
  });

  try {
    console.log("[bind] portal ok; trying jwxt sso");
    const jwxt = await continueJwxtSso(portal.cookieJar);
    const jwxtCookies = selectJwxtGradeCookies(jwxt.cookies);
    const hasRoute = jwxtCookies.some(c => c.name === "route");
    const hasJSession = jwxtCookies.some(c => c.name === "JSESSIONID");
    const hasRememberMe = jwxtCookies.some(c => c.name === "rememberMe");

    if (!hasRoute || !hasJSession || !hasRememberMe) {
      logBindVerifyFailed(null, {
        errorType: "missing_required_cookies",
        step: "selectJwxtGradeCookies",
        finalUrl: jwxt.finalUrl,
        message: "Missing required JWXT cookie names"
      });
      credentialStore.updateBoundAccountStatus(req.userId, "SSO_FAILED", {
        portalAuthStatus: "OK",
        clearLastJwxtLoginAt: true
      });
      deleteCookies(req.userId);
      return res.json(bindWarningResponse("SSO_FAILED"));
    }

    credentialStore.updateBoundAccountStatus(req.userId, "OK", {
      portalAuthStatus: "OK",
      lastJwxtLoginAt: new Date().toISOString()
    });
    writeCookies(jwxtCookies, req.userId);
    console.log("[api] portal verified and JWXT cookies refreshed");
    res.json({
      success: true,
      warning: false,
      code: 0,
      bound: true,
      verified: true,
      portalAuthStatus: "OK",
      jwxtStatus: "OK",
      finalUrl: jwxt.finalUrl,
      hasJSession: Boolean(jwxt.jwxtJSessionId)
    });
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    const publicStatus = jwxtPublicStatusFromError(classified.error);
    console.log("[bind] portal ok; jwxt classified error=" + classified.error);
    credentialStore.updateBoundAccountStatus(req.userId, publicStatus, {
      portalAuthStatus: "OK",
      clearLastJwxtLoginAt: true
    });
    deleteCookies(req.userId);
    return res.json(bindWarningResponse(publicStatus));
  }
});

// POST /unbind-account
app.post("/unbind-account", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "POST /unbind-account");
  try {
    credentialStore.deleteBoundAccount(req.userId);
    deleteCookies(req.userId);
    clearCaptchaSessionsForUser(req.userId);
    console.log("[api] JWXT account unbound; credentials and cookies removed; cached grades/timetable kept");
    res.json({ success: true, unbound: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "UNBIND_FAILED",
      message: err.message
    });
  }
});

// POST /upload-cookies
app.post("/upload-cookies", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    const data = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: "INVALID_FORMAT", message: "Body must be a JSON array" });
    }
    for (const c of data) {
      if (!c.name || !c.value) {
        return res.status(400).json({ success: false, error: "INVALID_ENTRY", message: "Each cookie needs name and value" });
      }
    }
    const hasJSession = data.some(c => c.name === "JSESSIONID");
    if (!hasJSession) {
      writeCookies(data, req.userId);
      console.log("[api] Cookies uploaded (WARNING: no JSESSIONID)");
      return res.json({ success: true, saved: true, error: "NO_JSESSIONID", message: "No JSESSIONID found. Grade queries will not work.", count: data.length, hasJSession: false });
    }
    writeCookies(data, req.userId);
    console.log("[api] Cookies uploaded: " + data.length + " entries (includes JSESSIONID)");
    res.json({ success: true, saved: true, count: data.length, hasJSession: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "WRITE_FAILED", message: err.message });
  }
});


// POST /upload-xg-session
app.post("/upload-xg-session", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    const scoreUrl = String((req.body && req.body.xgScoreUrl) || "").trim();
    const cookies = String((req.body && req.body.xgCookies) || "").trim();

    if (!scoreUrl || !cookies) {
      return res.status(400).json({
        success: false,
        error: "XG_SESSION_MISSING",
        message: "xgScoreUrl and xgCookies are required"
      });
    }

    let parsed;
    try {
      parsed = new URL(scoreUrl);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "XG_SCORE_PAGE_INVALID",
        message: "xgScoreUrl must be a valid URL"
      });
    }

    if (parsed.hostname !== "xg.tyust.edu.cn" || !parsed.pathname.includes("StuStudentScore.aspx")) {
      return res.status(400).json({
        success: false,
        error: "XG_SCORE_PAGE_INVALID",
        message: "xgScoreUrl must be a xg.tyust.edu.cn StuStudentScore.aspx URL"
      });
    }

    requestStorage(req).saveXgSession(scoreUrl, cookies);
    console.log("[api] XG score session uploaded cookieLength=" + cookies.length + " host=" + parsed.hostname);
    res.json({
      success: true,
      saved: true,
      xgScoreConfigured: true,
      cookieLength: cookies.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "XG_SESSION_SAVE_FAILED", message: err.message });
  }
});



// POST /grades/import
app.post("/grades/import", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    var d = req.body;
    if (!d || !d.grades) return res.status(400).json({success:false,message:"Missing grades field"});
    var g = d.grades;
    if (typeof g === "string") try { g = JSON.parse(g); } catch(e) {}
    if (!Array.isArray(g)) return res.status(400).json({success:false,message:"grades must be array"});
    requestStorage(req).mergeGrades(g);
    console.log("[api] Imported " + g.length + " grades");
    res.json({success:true,count:g.length});
  } catch(err) {
    res.status(500).json({success:false,message:err.message});
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log("API running on http://localhost:" + PORT);
  console.log("Endpoints: GET /status  GET /grades  POST /check  POST /upload-cookies");
});
