const express = require("express");
const { runCycle, runCycleForUser, loadCookies, writeCookies, deleteCookies } = require("./checker");
const axios = require("axios");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");
const { httpJwxtLogin } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");
const tokenStore = require("./auth/tokenStore");
const { optionalAuth } = require("./auth/authMiddleware");
const { safeUserId } = require("./services/userPaths");
const { classifyJwxtLoginError } = require("./services/jwxtLoginError");

const app = express();
const PORT = process.env.PORT || 3456;

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

app.use(express.json({ limit: "1mb" }));
app.use(optionalAuth);

function isProduction() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
}

function requestStorage(req) {
  return req.userId ? storage.createStorageForUser(req.userId) : storage;
}

function hasAuthHeader(req) {
  return Boolean(req.headers.authorization);
}

function ensureValidScope(req, res) {
  if (isProduction() && !req.userId) {
    res.status(401).json({ success: false, error: "INVALID_TOKEN", message: "Invalid or expired token" });
    return false;
  }
  if (hasAuthHeader(req) && !req.userId) {
    res.status(401).json({ success: false, error: "INVALID_TOKEN", message: "Invalid or expired token" });
    return false;
  }
  return true;
}

function logUserScope(req, label) {
  console.log("[user-scope] " + label + " scope=" + (req.userId ? "user" : "legacy"));
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
    const token = tokenStore.createToken(userId);
    console.log("[auth] wechat-login success");
    res.json({ success: true, token, userId });
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

app.get("/status", (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /status");
  const activeStorage = requestStorage(req);
  const cookies = loadCookies(req.userId);
  const valid = !!(cookies?.find(x => x.name === "JSESSIONID" && x.domain?.includes("newjwc")));
  const hasBoundAccount = req.userId ? Boolean(credentialStore.readBoundAccount(req.userId)) : Boolean(credentialStore.getJwxtCredentials());
  const unevaluatedCourses = buildUnevaluatedCourses(activeStorage);
  res.json({
    status: "running",
    cookieValid: valid,
    cookieStatus: valid ? "cookie_valid" : (hasBoundAccount ? "account_saved" : "login_required"),
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

app.get("/grades", (req, res) => {
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
app.get("/grade-changes", (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "GET /grade-changes");
  const activeStorage = requestStorage(req);
  const changes = activeStorage.getGradeChanges(20);
  res.json({ count: changes.length, changes });
});

// POST /check
app.post("/check", async (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "POST /check");
  const r = req.userId ? await runCycleForUser(req.userId) : await runCycle();
  if (r.success) res.json({ checked: true, gradesCount: r.gradesCount, added: r.added, changed: r.changed, changeCount: r.changeCount || 0, error: null, cookieStatus: r.cookieStatus || "cookie_valid" });
  else res.json({ checked: false, gradesCount: 0, added: [], changed: [], changeCount: 0, error: r.error, message: r.message, cookieStatus: r.cookieStatus || r.error || "query_error" });
});

// POST /bind-account
app.post("/bind-account", async (req, res) => {
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

  console.log("[user-scope] bind-account saving scope=" + (req.userId ? "user" : "legacy"));
  credentialStore.saveBoundAccount(studentId, password, req.userId);
  deleteCookies(req.userId);

  try {
    console.log("[bind] verifying jwxt");
    const login = await httpJwxtLogin(studentId, password);
    if (!login || login.success === false) {
      logBindVerifyFailed(null, {
        errorType: "success_false",
        step: "httpJwxtLogin",
        finalUrl: login && login.finalUrl,
        message: login && (login.message || login.error)
      });
      const classified = classifyJwxtLoginError(login && (login.message || login.error));
      console.log("[bind] classified error=" + classified.error);
      return res.json({
        success: true,
        bound: true,
        verified: false,
        reason: "jwxt_unavailable",
        message: "账号已保存，教务系统暂时不可用，稍后可再检查成绩"
      });
    }
    console.log("[bind] jwxt verified success");
    const jwxtCookies = selectJwxtGradeCookies(login.cookies);
    const hasRoute = jwxtCookies.some(c => c.name === "route");
    const hasJSession = jwxtCookies.some(c => c.name === "JSESSIONID");
    const hasRememberMe = jwxtCookies.some(c => c.name === "rememberMe");

    if (!hasRoute || !hasJSession || !hasRememberMe) {
      logBindVerifyFailed(null, {
        errorType: "missing_required_cookies",
        step: "selectJwxtGradeCookies",
        finalUrl: login.finalUrl,
        message: "Missing required JWXT cookie names"
      });
      console.log("[api] JWXT account saved but verification unavailable");
      return res.json({
        success: true,
        bound: true,
        verified: false,
        reason: "jwxt_unavailable",
        message: "账号已保存，教务系统暂时不可用，稍后可再检查成绩"
      });
    }

    writeCookies(jwxtCookies, req.userId);
    console.log("[api] JWXT account bound and verified");
    res.json({
      success: true,
      bound: true,
      verified: true,
      finalUrl: login.finalUrl,
      hasJSession: Boolean(login.jwxtJSessionId)
    });
  } catch (err) {
    logBindVerifyFailed(err, { step: "httpJwxtLogin" });
    const classified = classifyJwxtLoginError(err);
    console.log("[bind] classified error=" + classified.error);

    if (classified.error === "invalid_credentials") {
      credentialStore.deleteBoundAccount(req.userId);
      deleteCookies(req.userId);
      return res.status(400).json({
        success: false,
        error: "invalid_credentials",
        message: "账号或密码错误"
      });
    }

    if (classified.error === "captcha_required") {
      credentialStore.deleteBoundAccount(req.userId);
      deleteCookies(req.userId);
      return res.status(400).json({
        success: false,
        bound: false,
        verified: false,
        error: "captcha_required",
        message: "当前账号登录需要验证码或风控校验，请稍后重试"
      });
    }

    res.json({
      success: true,
      bound: true,
      verified: false,
      reason: "jwxt_unavailable",
      message: "账号已保存，教务系统暂时不可用，稍后可再检查成绩"
    });
  }
});

// POST /unbind-account
app.post("/unbind-account", (req, res) => {
  if (!ensureValidScope(req, res)) return;
  logUserScope(req, "POST /unbind-account");
  try {
    credentialStore.deleteBoundAccount(req.userId);
    deleteCookies(req.userId);
    console.log("[api] JWXT account unbound; account.json and cookies.json removed");
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
app.post("/upload-cookies", (req, res) => {
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
app.post("/grades/import", (req, res) => {
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
