const express = require("express");
const crypto = require("crypto");
const { runCycle, runCycleForUser, loadCookies, writeCookies, deleteCookies } = require("./checker");
const axios = require("axios");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");
const { httpJwxtLogin, httpPortalLogin, continueJwxtSso } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");
const auth = require("./middleware/auth");
const { signToken } = require("./utils/jwt");
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

// Background scheduler
const scheduler = new Scheduler(async () => {
  const r = await runCycle();
  if (r.success) console.log("[bg] " + r.gradesCount + " grades" + (r.added.length ? " +" + r.added.length : "") + (r.changed.length ? " ~" + r.changed.length : ""));
  else console.log("[bg] " + (r.error || r.message));
});
scheduler.start();

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
  res.json({
    status: "running",
    bound,
    portalAuthStatus: bound ? ((accountMeta && accountMeta.portalAuthStatus) || (credentials ? "OK" : "FAILED")) : "FAILED",
    jwxtStatus,
    cookieValid: valid,
    cookieStatus: legacyCookieStatus(jwxtStatus),
    totalGrades: activeStorage.getGrades().length,
    unevaluatedCount: unevaluatedCourses.length,
    unevaluatedCourses,
    lastCheckAt: activeStorage.data?.lastRunAt || null,
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
    var key = xnm + "_" + xqm;
    if (!map[key]) {
      map[key] = { key: key, xnm: xnm, xqm: xqm, termName: termLabel(xnm, xqm), grades: [] };
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

app.get("/grades", auth, (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /grades");
  const activeStorage = requestStorage(req);
  const grades = activeStorage.getGrades().map(g => ({
    kcmc: g.KCMC || g.kcmc, cj: g.CJ || g.cj, xf: g.XF || g.xf,
    xnm: g.XNM || g.xnm, xqm: g.XQM || g.xqm,
  }));
  res.json({ count: grades.length, grades, groupedGrades: buildGroupedGrades(grades) });
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
  const r = req.userId ? await runCycleForUser(req.userId) : await runCycle();
  if (r.success) res.json({ checked: true, gradesCount: r.gradesCount, added: r.added, changed: r.changed, changeCount: r.changeCount || 0, error: null, cookieStatus: r.cookieStatus || "cookie_valid" });
  else {
    const classified = classifyJwxtLoginError(r.error || r.message || r);
    const code = r.error && String(r.error).startsWith("JWXT_") ? r.error : classified.error;
    res.json({ checked: false, gradesCount: 0, added: [], changed: [], changeCount: 0, error: code, message: r.message || classified.message, cookieStatus: r.cookieStatus || code || "query_error" });
  }
});

function apiErrorStatus(code) {
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
  return rows.length ? "" : "暂无课表，请点击刷新课表";
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
  const todayRows = rows
    .filter(item => Number(item.weekday) === Number(info.weekday))
    .filter(item => timetableAppliesToWeek(item, info.weekNumber))
    .sort((a, b) => Number(a.section) - Number(b.section));

  res.json({
    success: true,
    ...info,
    hasTimetable: rows.length > 0,
    message: emptyTimetableMessage(rows),
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
  const filtered = rows
    .filter(item => timetableAppliesToWeek(item, info.weekNumber))
    .sort((a, b) => Number(a.weekday) - Number(b.weekday) || Number(a.section) - Number(b.section));

  const days = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({
    weekday,
    sections: fillDaySections(filtered.filter(item => Number(item.weekday) === weekday))
  }));

  res.json({
    success: true,
    ...info,
    hasTimetable: rows.length > 0,
    message: emptyTimetableMessage(rows),
    debug: timetableDebug(info, rows.length, filtered.length),
    days
  });
});

// POST /timetable/sync
app.post("/timetable/sync", auth, async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  try {
    console.log("[timetable] sync start userHash=" + safeUserHash(req.userId));
    const result = await syncTimetableForUser(req.userId, requestStorage(req), {
      term: loadConfiguredTerm()
    });
    if (result && result.success === false) {
      console.log("[timetable] sync empty rawCount=" + result.rawCount);
      return res.json(result);
    }
    console.log("[timetable] sync success syncedCount=" + result.syncedCount);
    res.json(result);
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    const code = err && err.code ? err.code : classified.error;
    console.log("[timetable] sync failed code=" + code);
    if (sendTermConfigError(res, err)) return;
    const status = apiErrorStatus(code);
    res.status(status).json({
      success: false,
      error: code,
      message: err && err.message ? err.message : classified.message
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
