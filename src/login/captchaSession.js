const crypto = require("crypto");
const credentialStore = require("../services/credentialStore");
const { writeCookies } = require("../checker");
const { classifyJwxtLoginError } = require("../services/jwxtLoginError");
const {
  createCookieJar,
  parseHiddenValue,
  requestNoRedirect,
  followRedirects,
  getAndFollow,
  encryptPassword,
  isInvalidCredentialPage,
  findJwxtJSessionId,
  LOGIN_URL,
  LOGIN_POST_URL,
  CAS_ORIGIN,
  PORTAL_ORIGIN,
  JWXT_SSO_URL,
  userAgent
} = require("./httpJwxtLogin");

const CAPTCHA_PATH = "/api/captcha/generate/DEFAULT";
const SESSION_TTL_MS = 5 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 8000;
const sessions = new Map();
const rateLimit = new Map();

function now() {
  return Date.now();
}

function cleanupExpiredSessions() {
  const t = now();
  for (const [id, session] of sessions.entries()) {
    if (!session || session.expiresAt <= t) sessions.delete(id);
  }
}

function clearCaptchaSessionsForUser(userId) {
  const expected = String(userId || "");
  for (const [id, session] of sessions.entries()) {
    if (session && session.userId === expected) sessions.delete(id);
  }
}

function checkRateLimit(userId, action) {
  const key = String(userId || "") + ":" + String(action || "default");
  const t = now();
  const last = rateLimit.get(key) || 0;
  if (t - last < MIN_REQUEST_INTERVAL_MS) {
    const err = new Error("操作过于频繁，请稍后再试");
    err.code = "RATE_LIMITED";
    throw err;
  }
  rateLimit.set(key, t);
}

function mimeType(headers) {
  const contentType = String(headers && headers["content-type"] || "").split(";")[0].trim();
  return contentType || "image/png";
}

async function createCaptchaSession(userId) {
  cleanupExpiredSessions();
  checkRateLimit(userId, "captcha-session");

  const cookieJar = createCookieJar();
  const loginPage = await requestNoRedirect(cookieJar, "GET", LOGIN_URL, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  const html = String(loginPage.data || "");
  const execution = parseHiddenValue(html, "login-page-flowkey");
  const loginCroypto = parseHiddenValue(html, "login-croypto");
  if (!execution || !loginCroypto) {
    const err = new Error("教务登录页缺少必要字段，请稍后重试");
    err.code = "JWXT_LOGIN_PAGE_INVALID";
    throw err;
  }

  const captchaUrl = CAS_ORIGIN + CAPTCHA_PATH + "?_=" + now();
  const captchaResp = await requestNoRedirect(cookieJar, "GET", captchaUrl, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": LOGIN_URL
    },
    responseType: "arraybuffer",
    timeout: 15000
  });

  if (captchaResp.status !== 200 || !captchaResp.data) {
    const err = new Error("获取验证码失败");
    err.code = "CAPTCHA_FETCH_FAILED";
    throw err;
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    userId: String(userId),
    cookieJar,
    execution,
    loginCroypto,
    expiresAt: now() + SESSION_TTL_MS
  });

  const image = Buffer.from(captchaResp.data).toString("base64");
  return {
    success: true,
    sessionId,
    captchaImage: "data:" + mimeType(captchaResp.headers) + ";base64," + image
  };
}

function getSession(sessionId, userId) {
  cleanupExpiredSessions();
  const session = sessions.get(String(sessionId || ""));
  if (!session || session.userId !== String(userId)) {
    const err = new Error("验证码会话已过期，请重新获取验证码");
    err.code = "CAPTCHA_SESSION_EXPIRED";
    throw err;
  }
  return session;
}

function selectJwxtCookies(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const isJwglxtPath = cookiePath => cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
  const route = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/");
  const jsession = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path));
  const rememberMe = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path));
  return [route, jsession, rememberMe].filter(Boolean);
}

async function loginWithCaptcha(userId, payload) {
  checkRateLimit(userId, "captcha-login");
  const session = getSession(payload && payload.sessionId, userId);
  const studentId = String((payload && payload.studentId) || "").trim();
  const password = String((payload && payload.password) || "");
  const captcha = String((payload && payload.captcha) || "").trim();

  if (!studentId || !password || !captcha) {
    const err = new Error("请填写学号、密码和验证码");
    err.code = "INVALID_CAPTCHA_LOGIN_INPUT";
    throw err;
  }

  const encryptedPassword = encryptPassword(session.loginCroypto, password);
  if (!encryptedPassword) {
    const err = new Error("教务密码加密失败");
    err.code = "JWXT_LOGIN_FAILED";
    throw err;
  }

  const form = new URLSearchParams({
    username: studentId,
    password: encryptedPassword,
    type: "UsernamePassword",
    _eventId: "submit",
    geolocation: "",
    execution: session.execution,
    captcha_code: captcha,
    croypto: session.loginCroypto
  }).toString();

  const loginResponse = await requestNoRedirect(session.cookieJar, "POST", LOGIN_POST_URL, {
    data: form,
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": CAS_ORIGIN,
      "Referer": LOGIN_URL
    }
  });

  const followed = await followRedirects(session.cookieJar, loginResponse, LOGIN_POST_URL);
  let portal = followed;
  if (followed.finalUrl.includes(PORTAL_ORIGIN + "/sso/login?code=")) {
    portal = await getAndFollow(session.cookieJar, followed.finalUrl, LOGIN_POST_URL);
  }

  const body = String((portal.response && portal.response.data) || "");
  if (isInvalidCredentialPage(body)) {
    const err = new Error("账号或密码错误");
    err.message = "学号或教务密码错误，请检查后重试";
    err.code = "JWXT_INVALID_CREDENTIALS";
    throw err;
  }

  if (!portal.finalUrl || !portal.finalUrl.includes(PORTAL_ORIGIN)) {
    const err = new Error("验证码或登录信息错误，请重新获取验证码");
    err.message = "验证码错误，请重新输入或刷新验证码";
    err.code = "JWXT_CAPTCHA_INVALID";
    throw err;
  }

  let jwxt;
  try {
    jwxt = await getAndFollow(session.cookieJar, JWXT_SSO_URL, PORTAL_ORIGIN + "/index");
  } catch (err) {
    const classified = classifyJwxtLoginError(err);
    err.code = classified.error;
    err.message = classified.message;
    throw err;
  }
  const jwxtJSessionId = findJwxtJSessionId(session.cookieJar);
  if (!jwxtJSessionId) {
    const err = new Error("教务系统登录失败，未获取到有效 Cookie");
    err.message = "JWXT JSESSIONID was not found after SSO redirects.";
    err.code = "JWXT_SSO_FAILED";
    throw err;
  }

  const jwxtCookies = selectJwxtCookies(session.cookieJar);
  credentialStore.saveBoundAccount(studentId, password, userId);
  credentialStore.updateBoundAccountStatus(userId, "COOKIE_VALID", { lastJwxtLoginAt: new Date().toISOString() });
  writeCookies(jwxtCookies, userId);
  sessions.delete(String(payload.sessionId || ""));

  return {
    success: true,
    message: "教务账号绑定成功",
    finalUrl: jwxt.finalUrl
  };
}

module.exports = {
  createCaptchaSession,
  loginWithCaptcha,
  clearCaptchaSessionsForUser
};
