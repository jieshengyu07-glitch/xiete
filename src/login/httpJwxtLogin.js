const axios = require("axios");
const CryptoJS = require("crypto-js");
const {
  isJwxtUpstreamFailure,
  normalizeJwxtLoginError
} = require("../services/jwxtLoginError");

const CAS_ORIGIN = "https://sso1.tyust.edu.cn";
const PORTAL_ORIGIN = "https://ronghemenhu.tyust.edu.cn";
const JWXT_ORIGIN = "https://newjwc.tyust.edu.cn";
const JWXT_SSO_URL = JWXT_ORIGIN + "/sso/jasiglogin/jwglxt";
const SERVICE_URL =
  CAS_ORIGIN +
  "/oauth2.0/callbackAuthorize?client_id=rhmh" +
  "&redirect_uri=https%3A%2F%2Fronghemenhu.tyust.edu.cn%2Fsso%2Flogin" +
  "&response_type=code" +
  "&client_name=CasOAuthClient";
const LOGIN_URL = CAS_ORIGIN + "/login?service=" + encodeURIComponent(SERVICE_URL);
const LOGIN_POST_URL = CAS_ORIGIN + "/login";
const MAX_REDIRECTS = 30;

function createCookieJar() {
  return [];
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseHiddenValue(html, id) {
  const pattern = new RegExp("<[^>]+id=[\"']" + id + "[\"'][^>]*>([^<]*)<\\/[^>]+>", "i");
  const match = String(html || "").match(pattern);
  return match ? decodeHtml(match[1].trim()) : "";
}

function parseInputValue(html, name) {
  const text = String(html || "");
  const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp("<input\\b[^>]*(?:name|id)=[\\\"']" + escaped + "[\\\"'][^>]*\\bvalue=[\\\"']([^\\\"']*)[\\\"']", "i"),
    new RegExp("<input\\b[^>]*\\bvalue=[\\\"']([^\\\"']*)[\\\"'][^>]*(?:name|id)=[\\\"']" + escaped + "[\\\"']", "i")
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return decodeHtml(match[1].trim());
  }
  return "";
}

function parseCurrentSsoLoginForm(html) {
  const text = String(html || "");
  return {
    execution: parseHiddenValue(text, "execution") ||
      parseInputValue(text, "execution") ||
      parseHiddenValue(text, "login-page-flowkey"),
    crypto: parseHiddenValue(text, "crypto") ||
      parseInputValue(text, "crypto") ||
      parseHiddenValue(text, "login-croypto"),
    captchaPayload: parseHiddenValue(text, "captcha_payload") ||
      parseInputValue(text, "captcha_payload"),
    service: parseInputValue(text, "service")
  };
}

function buildCurrentSsoLoginPayload({ username, password, execution, crypto, captchaCode, captchaPayload, service }) {
  const fields = {
    username: String(username || ""),
    type: "UsernamePassword",
    _eventId: "submit",
    geolocation: "",
    execution: String(execution || ""),
    captcha_code: String(captchaCode || ""),
    password: String(password || ""),
    captcha_payload: String(captchaPayload || ""),
    croypto: String(crypto || "")
  };
  if (service) fields.service = String(service);
  return new URLSearchParams(fields).toString();
}

function isInvalidCredentialPage(html) {
  return normalizeJwxtLoginError(String(html || "")).error === "JWXT_INVALID_CREDENTIALS";
}

function isExplicitCaptchaPage(html) {
  const code = normalizeJwxtLoginError(String(html || "")).error;
  return [
    "JWXT_CAPTCHA_REQUIRED",
    "JWXT_CAPTCHA_INVALID",
    "JWXT_CAPTCHA_SESSION_EXPIRED"
  ].includes(code);
}

function throwJwxtError(code, message, meta) {
  const err = new Error(message || code);
  err.code = code;
  if (meta && typeof meta === "object") Object.assign(err, meta);
  throw err;
}

function safeUrlParts(url) {
  try {
    const parsed = new URL(String(url || ""));
    return {
      host: parsed.hostname,
      pathname: parsed.pathname || "/"
    };
  } catch (err) {
    return {
      host: "",
      pathname: ""
    };
  }
}

function includesAnyText(text, patterns) {
  return patterns.some(pattern => text.includes(pattern));
}

function portalDiagnostics(response, finalUrl) {
  const html = String(response && response.data ? response.data : "");
  const lower = html.toLowerCase();
  const url = String(finalUrl || (response && response.config && response.config.url) || "");
  const parts = safeUrlParts(url);
  const contentType = String(response && response.headers && response.headers["content-type"] || "").split(";")[0];
  const containsLoginForm = lower.includes("<form") && (
    lower.includes("password") ||
    lower.includes("login-page-flowkey") ||
    lower.includes("login-croypto") ||
    lower.includes("_eventid")
  );
  const containsCaptcha = isExplicitCaptchaPage(html);
  const containsMaintenance = includesAnyText(lower, [
    "maintenance",
    "service unavailable",
    "temporarily unavailable"
  ]) || includesAnyText(html, [
    "维护",
    "升级",
    "暂停服务",
    "系统繁忙",
    "鏆傚仠",
    "绯荤粺绻佸繖"
  ]);
  return {
    status: response && response.status ? response.status : 0,
    finalHost: parts.host,
    pathname: parts.pathname,
    contentType,
    containsPortalHome: parts.host === "ronghemenhu.tyust.edu.cn" && parts.pathname !== "/sso/login",
    containsLoginForm,
    containsInvalidCredential: isInvalidCredentialPage(html),
    containsCaptcha,
    containsMaintenance
  };
}

function attachPortalStage(err, response, finalUrl) {
  err.portalStage = true;
  err.portalResult = portalDiagnostics(response, finalUrl);
  return err;
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

function hostnameOf(url) {
  return new URL(url).hostname.toLowerCase();
}

function pathnameOf(url) {
  return new URL(url).pathname || "/";
}

function absoluteUrl(location, baseUrl) {
  return new URL(location, baseUrl).toString();
}

function safeUrlForLog(url, baseUrl) {
  try {
    const parsed = new URL(String(url || ""), baseUrl);
    return parsed.origin + parsed.pathname;
  } catch (err) {
    return "[unparseable-url]";
  }
}

function sanitizeSsoErrorMessage(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(password|passwd|execution|crypto|captcha[_-]?payload|captcha[_-]?code|cookie|ticket|code)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function logSsoRequestFailure(stage, err) {
  const response = err && err.response;
  const cause = err && err.cause;
  const responseStatus = response && Number(response.status) > 0 ? Number(response.status) : "none";
  const requestConfig = err && err.config;
  const requestUrl = requestConfig && requestConfig.url;
  const requestHost = requestUrl ? safeUrlParts(requestUrl).host : "unknown";
  const requestMethod = requestConfig && requestConfig.method ? String(requestConfig.method).toUpperCase() : "unknown";
  const startedAt = Number(err && err.ssoStartedAt);
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : "unknown";
  const timeoutMs = Number(err && err.ssoTimeoutMs) || "unknown";
  console.log("[sso] request-failed" +
    " stage=" + String(stage || "UNKNOWN") +
    " method=" + requestMethod +
    " hostname=" + requestHost +
    " elapsedMs=" + elapsedMs +
    " timeoutMs=" + timeoutMs +
    " name=" + String((err && err.name) || "Error") +
    " code=" + String((err && err.code) || "none") +
    " message=" + sanitizeSsoErrorMessage(err && err.message) +
    " hasResponse=" + Boolean(response) +
    " responseStatus=" + responseStatus +
    " causeCode=" + String((cause && cause.code) || "none"));
}

function logSsoFlowFailure(stage, reasonCode, err, url) {
  const parts = safeUrlParts(url || (err && err.config && err.config.url) || LOGIN_URL);
  console.log("[sso] flow-failed" +
    " stage=" + String(stage || "UNKNOWN") +
    " reasonCode=" + String(reasonCode || (err && err.code) || "FLOW_ERROR") +
    " hostname=" + (parts.host || "unknown") +
    " pathname=" + (parts.pathname || "unknown") +
    " hasResponse=" + Boolean(err && err.response));
}

function parseSetCookie(header, responseUrl) {
  const parts = String(header || "").split(";").map(part => part.trim());
  const first = parts.shift() || "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;

  const cookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
    domain: hostnameOf(responseUrl),
    path: "/"
  };

  parts.forEach(part => {
    const idx = part.indexOf("=");
    const key = (idx >= 0 ? part.slice(0, idx) : part).trim().toLowerCase();
    const value = idx >= 0 ? part.slice(idx + 1).trim() : "";
    if (key === "domain" && value) cookie.domain = value.replace(/^\./, "").toLowerCase();
    if (key === "path" && value) cookie.path = value;
  });

  return cookie;
}

function storeCookies(cookieJar, setCookieHeaders, responseUrl) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  headers.forEach(header => {
    const cookie = parseSetCookie(header, responseUrl);
    if (!cookie) return;

    const index = cookieJar.findIndex(existing =>
      existing.name === cookie.name &&
      existing.domain === cookie.domain &&
      existing.path === cookie.path
    );

    if (index >= 0) cookieJar[index] = cookie;
    else cookieJar.push(cookie);
  });
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function pathMatches(requestPath, cookiePath) {
  return requestPath === cookiePath ||
    requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : cookiePath + "/");
}

function cookieHeaderFor(cookieJar, url) {
  const host = hostnameOf(url);
  const path = pathnameOf(url);
  return cookieJar
    .filter(cookie => domainMatches(host, cookie.domain) && pathMatches(path, cookie.path))
    .map(cookie => cookie.name + "=" + cookie.value)
    .join("; ");
}

function cookieNamesForUrl(cookieJar, url) {
  const host = hostnameOf(url);
  const path = pathnameOf(url);
  return cookieJar
    .filter(cookie => domainMatches(host, cookie.domain) && pathMatches(path, cookie.path))
    .map(cookie => cookie.name);
}

function logSsoCookieState(stage, cookieJar, url) {
  const names = cookieNamesForUrl(cookieJar, url);
  const parts = safeUrlParts(url);
  console.log("[sso] cookie-state" +
    " stage=" + String(stage || "UNKNOWN") +
    " hostname=" + (parts.host || "unknown") +
    " pathname=" + (parts.pathname || "unknown") +
    " count=" + names.length +
    " names=" + (names.length ? names.join(",") : "none"));
}

function ssoValueShape(value) {
  const text = String(value == null ? "" : value);
  if (!text) return "empty";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return "uuid-like";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return "json-like";
  } catch (err) {}
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0 && (/[+/=]/.test(text) || text.length >= 24)) return "base64-like";
  return "plain";
}

function describeSsoPostShape(form, headers, cookieJar, url) {
  const body = String(form || "");
  const params = new URLSearchParams(body);
  const entries = Array.from(params.entries());
  const fieldNames = entries.map(entry => entry[0]);
  const lines = [
    "[sso] post-shape",
    "fields=" + fieldNames.join(","),
    "contentType=" + String((headers && (headers["Content-Type"] || headers["content-type"])) || "unknown"),
    "originHost=" + safeUrlParts(headers && headers.Origin).host,
    "referer=" + safeUrlForLog(headers && headers.Referer, url),
    "cookieNames=" + (cookieNamesForUrl(cookieJar || [], url).join(",") || "none"),
    "bodyLength=" + Buffer.byteLength(body, "utf8")
  ];
  entries.forEach(([name, value]) => {
    lines.push(name + ".empty=" + (value === "" ? "YES" : "NO"));
    lines.push(name + ".len=" + Buffer.byteLength(value, "utf8"));
    lines.push(name + ".shape=" + ssoValueShape(value));
  });
  console.log(lines.join("\n"));
  return { fieldNames, bodyLength: Buffer.byteLength(body, "utf8") };
}

function cookieNamesForDomain(cookieJar, domain) {
  return Array.from(new Set(
    cookieJar
      .filter(cookie => cookie.domain === domain)
      .map(cookie => cookie.name)
  ));
}

function setCookieNames(setCookieHeaders) {
  if (!setCookieHeaders) return [];
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return headers
    .map(header => String(header).split(";")[0].split("=")[0].trim())
    .filter(Boolean);
}

function cookieNamesFromCookieHeader(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map(part => part.trim().split("=")[0])
    .filter(Boolean);
}

function printHttpStep(cookieJar, url, response) {
  const location = response.headers && response.headers.location ? response.headers.location : "";
  const names = setCookieNames(response.headers && response.headers["set-cookie"]);
  const sentCookieHeader = response.config && response.config.headers ? response.config.headers.Cookie : "";
  const requestCookieNames = cookieNamesFromCookieHeader(sentCookieHeader);

  console.log("[JWXT SSO]");
  console.log("URL: " + safeUrlForLog(url));
  console.log("HTTP status: " + response.status);
  console.log("Location: " + (location ? safeUrlForLog(location, url) : "(none)"));
  console.log("Set-Cookie names: " + (names.length ? names.join(", ") : "(none)"));
  console.log("Request Cookie names: " + (requestCookieNames.length ? requestCookieNames.join(", ") : "(none)"));
}

function newjwcCookieMetas(cookieJar) {
  return cookieJar
    .filter(cookie => cookie.domain === "newjwc.tyust.edu.cn")
    .map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path
    }));
}

function jwxtPathFlags(urls) {
  return {
    reachedJasigLogin: urls.some(url => String(url).includes("/sso/jasiglogin/jwglxt")),
    reachedTicketLogin: urls.some(url => String(url).includes("/jwglxt/ticketlogin")),
    reachedIndexInitMenu: urls.some(url => String(url).includes("/jwglxt/xtgl/index_initMenu.html"))
  };
}

function printJwxtDebugSummary(cookieJar, finalUrl, urls) {
  const flags = jwxtPathFlags(urls);
  const metas = newjwcCookieMetas(cookieJar);

  console.log("\n=== JWXT SSO Debug Summary ===");
  console.log("Final URL: " + safeUrlForLog(finalUrl));
  console.log("Reached /sso/jasiglogin/jwglxt: " + (flags.reachedJasigLogin ? "YES" : "NO"));
  console.log("Reached /jwglxt/ticketlogin: " + (flags.reachedTicketLogin ? "YES" : "NO"));
  console.log("Reached /jwglxt/xtgl/index_initMenu.html: " + (flags.reachedIndexInitMenu ? "YES" : "NO"));
  console.log("newjwc.tyust.edu.cn cookies:");
  if (!metas.length) {
    console.log("(none)");
  } else {
    metas.forEach(cookie => {
      console.log("- name=" + cookie.name + " domain=" + cookie.domain + " path=" + cookie.path);
    });
  }
}

function printCasCookieSummary(cookieJar, label) {
  const names = cookieNamesForDomain(cookieJar, "sso1.tyust.edu.cn");
  const watched = ["SOURCEID_TGC", "rg_objectid", "SESSION", "JSESSIONID"];
  const tgcLike = names.filter(name => name.toUpperCase().includes("TGC"));

  console.log("\n=== CAS Cookie Debug: " + label + " ===");
  console.log("sso1.tyust.edu.cn cookie names: " + (names.length ? names.join(", ") : "(none)"));
  watched.forEach(name => {
    console.log("Has " + name + ": " + (names.includes(name) ? "YES" : "NO"));
  });
  console.log("TGC-like cookie names: " + (tgcLike.length ? tgcLike.join(", ") : "(none)"));
}

function findJwxtJSessionId(cookieJar) {
  const cookie = cookieJar.find(item =>
    item.domain === "newjwc.tyust.edu.cn" &&
    (item.path === "/jwglxt" || item.path.startsWith("/jwglxt/")) &&
    item.name === "JSESSIONID"
  );
  return cookie ? cookie.value : "";
}

async function requestNoRedirect(cookieJar, method, url, options) {
  const headers = Object.assign({}, options && options.headers);
  const cookieHeader = cookieHeaderFor(cookieJar, url);
  if (cookieHeader) headers.Cookie = cookieHeader;

  let response;
  const startedAt = Date.now();
  const timeoutMs = options && options.timeout ? options.timeout : 15000;
  try {
    response = await axios({
      method,
      url,
      data: options && options.data,
      headers,
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: timeoutMs,
      responseType: options && options.responseType
    });
  } catch (err) {
    err.ssoStartedAt = startedAt;
    err.ssoTimeoutMs = timeoutMs;
    logSsoRequestFailure(options && options.stage, err);
    throw err;
  }

  storeCookies(cookieJar, response.headers["set-cookie"], url);
  return response;
}

async function followRedirects(cookieJar, startResponse, startUrl, options) {
  let response = startResponse;
  let currentUrl = startUrl;
  const trace = Boolean(options && options.trace);
  const urls = options && options.urls ? options.urls : [];

  urls.push(currentUrl);
  if (trace) printHttpStep(cookieJar, currentUrl, response);

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const location = response.headers && response.headers.location;
    if (!location || response.status < 300 || response.status >= 400) break;

    let nextUrl;
    try {
      nextUrl = absoluteUrl(location, currentUrl);
    } catch (err) {
      err.config = err.config || { method: "GET", url: currentUrl };
      logSsoRequestFailure("FOLLOW_REDIRECT", err);
      throw err;
    }
    const previousUrl = currentUrl;
    currentUrl = nextUrl;
    urls.push(currentUrl);

    response = await requestNoRedirect(cookieJar, "GET", currentUrl, {
      stage: "FOLLOW_REDIRECT",
      headers: {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": previousUrl
      }
    });
    if (trace) printHttpStep(cookieJar, currentUrl, response);
  }

  return { response, finalUrl: currentUrl, urls };
}

async function getAndFollow(cookieJar, url, referer, options) {
  const response = await requestNoRedirect(cookieJar, "GET", url, {
    stage: options && options.stage ? options.stage : "FOLLOW_REDIRECT",
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": referer || LOGIN_URL
    }
  });
  return followRedirects(cookieJar, response, url, options);
}

function encryptPassword(loginCroypto, password) {
  const key = CryptoJS.enc.Base64.parse(loginCroypto);
  return CryptoJS.AES.encrypt(password, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString();
}

// The public CAS login bundle always submits an encrypted JSON object here.
// With no interactive challenge completed, the browser value is AES("{}").
function encryptCaptchaPayload(loginCroypto, captchaPayload) {
  const key = CryptoJS.enc.Base64.parse(loginCroypto);
  let value = captchaPayload;
  if (value === undefined || value === null || value === "") value = {};
  if (typeof value !== "string") value = JSON.stringify(value);
  return CryptoJS.AES.encrypt(value, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString();
}

async function checkCaptcha(cookieJar, studentId) {
  const url = CAS_ORIGIN + "/api/protected/user/findCaptchaCount/" + encodeURIComponent(studentId);
  const response = await requestNoRedirect(cookieJar, "GET", url, {
    stage: "CAPTCHA_PRECHECK",
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Referer": LOGIN_URL
    }
  });

  const data = response.data || {};
  return Boolean(data && data.data && data.data.captchaInvisible);
}

async function loginCasToPortal(cookieJar, studentId, password) {
  const loginPage = await requestNoRedirect(cookieJar, "GET", LOGIN_URL, {
    stage: "GET_LOGIN_PAGE",
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (isJwxtUpstreamFailure({ response: loginPage })) {
    throwJwxtError("JWXT_UNAVAILABLE", "学校官网叒崩了，一会再重试吧", {
      portalStage: true,
      portalResult: portalDiagnostics(loginPage, LOGIN_URL)
    });
  }

  const html = String(loginPage.data || "");
  logSsoCookieState("GET_LOGIN_PAGE_COMPLETE", cookieJar, LOGIN_URL);
  if (!html.trim()) {
    throwJwxtError("JWXT_UNAVAILABLE", "学校官网叒崩了，一会再重试吧", {
      upstreamResponseEmpty: true,
      portalStage: true,
      portalResult: portalDiagnostics(loginPage, LOGIN_URL)
    });
  }
  let protocol;
  try {
    protocol = parseCurrentSsoLoginForm(html);
  } catch (err) {
    logSsoFlowFailure("GET_LOGIN_PAGE_PARSE", "LOGIN_FORM_PARSE_FAILED", err, LOGIN_URL);
    throw err;
  }
  const execution = protocol.execution;
  const loginCroypto = protocol.crypto;
  const needsCaptcha = await checkCaptcha(cookieJar, studentId).catch(() => false);

  if (needsCaptcha) throwJwxtError("JWXT_CAPTCHA_REQUIRED", "教务系统需要验证码，请输入验证码完成验证", {
    portalStage: true,
    portalResult: portalDiagnostics(loginPage, LOGIN_URL)
  });
  if (!execution) throwJwxtError("JWXT_SSO_FAILED", "教务系统登录态获取失败，请稍后重试；如果一直失败，请确认你能在官网登录并进入教务系统", {
    portalStage: true,
    portalResult: portalDiagnostics(loginPage, LOGIN_URL)
  });
  if (!loginCroypto) throwJwxtError("JWXT_SSO_FAILED", "教务系统登录态获取失败，请稍后重试；如果一直失败，请确认你能在官网登录并进入教务系统", {
    portalStage: true,
    portalResult: portalDiagnostics(loginPage, LOGIN_URL)
  });

  let encryptedPassword;
  try {
    encryptedPassword = encryptPassword(loginCroypto, password);
  } catch (err) {
    logSsoFlowFailure("BUILD_LOGIN_PAYLOAD", "PASSWORD_TRANSFORM_FAILED", err, LOGIN_POST_URL);
    throw err;
  }
  if (!encryptedPassword) {
    const err = new Error("DES password encryption failed.");
    logSsoFlowFailure("BUILD_LOGIN_PAYLOAD", "PASSWORD_TRANSFORM_EMPTY", err, LOGIN_POST_URL);
    throw err;
  }

  let form;
  try {
    form = buildCurrentSsoLoginPayload({
      username: studentId,
      password: encryptedPassword,
      execution,
      crypto: loginCroypto,
      captchaPayload: encryptCaptchaPayload(loginCroypto, protocol.captchaPayload)
    });
  } catch (err) {
    logSsoFlowFailure("BUILD_LOGIN_PAYLOAD", "LOGIN_PAYLOAD_BUILD_FAILED", err, LOGIN_POST_URL);
    throw err;
  }

  describeSsoPostShape(form, {
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": CAS_ORIGIN,
    "Referer": LOGIN_URL
  }, cookieJar, LOGIN_POST_URL);

  const loginResponse = await requestNoRedirect(cookieJar, "POST", LOGIN_POST_URL, {
    stage: "POST_LOGIN",
    data: form,
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": CAS_ORIGIN,
      "Referer": LOGIN_URL
    }
  });
  logSsoCookieState("POST_LOGIN_SENT", cookieJar, LOGIN_POST_URL);

  if (isJwxtUpstreamFailure({ response: loginResponse })) {
    throwJwxtError("JWXT_UNAVAILABLE", "学校官网叒崩了，一会再重试吧", {
      portalStage: true,
      portalResult: portalDiagnostics(loginResponse, LOGIN_POST_URL)
    });
  }

  const followed = await followRedirects(cookieJar, loginResponse, LOGIN_POST_URL);
  if (followed.response && isJwxtUpstreamFailure({ response: followed.response })) {
    throwJwxtError("JWXT_UNAVAILABLE", "学校官网叒崩了，一会再重试吧", {
      portalStage: true,
      portalResult: portalDiagnostics(followed.response, followed.finalUrl)
    });
  }

  if (followed.finalUrl.includes(PORTAL_ORIGIN + "/sso/login?code=")) {
    return getAndFollow(cookieJar, followed.finalUrl, LOGIN_POST_URL);
  }
  if (isInvalidCredentialPage(followed.response && followed.response.data)) {
    throwJwxtError("JWXT_INVALID_CREDENTIALS", "学号或密码错误，请重新输入", {
      portalStage: true,
      portalResult: portalDiagnostics(followed.response, followed.finalUrl)
    });
  }
  const followedPortalResult = portalDiagnostics(followed.response, followed.finalUrl);
  if (followedPortalResult.containsLoginForm) {
    throwJwxtError("JWXT_LOGIN_FAILED", "Portal login was not confirmed.", {
      portalStage: true,
      portalResult: followedPortalResult
    });
  }
  if (!String(followed.finalUrl || "").includes(PORTAL_ORIGIN)) {
    throwJwxtError("JWXT_LOGIN_FAILED", "Portal login was not confirmed.", {
      portalStage: true,
      portalResult: portalDiagnostics(followed.response, followed.finalUrl)
    });
  }
  return followed;
}

async function httpJwxtLogin(studentId, password, options) {
  if (!studentId) throw new Error("studentId is required.");
  if (!password) throw new Error("password is required.");

  const portal = await httpPortalLogin(studentId, password);
  return continueJwxtSso(portal.cookieJar, options);
}

async function httpPortalLogin(studentId, password) {
  if (!studentId) throw new Error("studentId is required.");
  if (!password) throw new Error("password is required.");

  const cookieJar = createCookieJar();
  let portal;
  try {
    portal = await loginCasToPortal(cookieJar, studentId, password);
  } catch (err) {
    if (err && !err.portalResult) {
      attachPortalStage(err, err.response, err.config && err.config.url ? err.config.url : LOGIN_URL);
    }
    throw err;
  }
  return {
    success: true,
    cookieJar,
    cookies: cookieJar.slice(),
    finalUrl: portal.finalUrl,
    portalResult: portalDiagnostics(portal.response, portal.finalUrl)
  };
}

async function continueJwxtSso(cookieJar, options) {
  const jwxtTraceUrls = [];
  const debug = Boolean(options && options.debug);
  if (debug) printCasCookieSummary(cookieJar, "before JWXT SSO");
  const jwxt = await getAndFollow(cookieJar, JWXT_SSO_URL, PORTAL_ORIGIN + "/index", {
    trace: debug,
    urls: jwxtTraceUrls
  });
  const jwxtJSessionId = findJwxtJSessionId(cookieJar);

  if (debug) printJwxtDebugSummary(cookieJar, jwxt.finalUrl, jwxtTraceUrls);

  if (!jwxtJSessionId) {
    throwJwxtError("JWXT_SSO_FAILED", "JWXT JSESSIONID was not found after SSO redirects.");
  }

  return {
    success: true,
    cookies: cookieJar.slice(),
    jwxtJSessionId,
    finalUrl: jwxt.finalUrl
  };
}

module.exports = {
  httpJwxtLogin,
  httpPortalLogin,
  continueJwxtSso,
  createCookieJar,
  parseHiddenValue,
  requestNoRedirect,
  followRedirects,
  getAndFollow,
  encryptPassword,
  encryptCaptchaPayload,
  parseCurrentSsoLoginForm,
  buildCurrentSsoLoginPayload,
  sanitizeSsoErrorMessage,
  logSsoRequestFailure,
  logSsoFlowFailure,
  logSsoCookieState,
  ssoValueShape,
  describeSsoPostShape,
  isInvalidCredentialPage,
  isExplicitCaptchaPage,
  findJwxtJSessionId,
  LOGIN_URL,
  LOGIN_POST_URL,
  CAS_ORIGIN,
  PORTAL_ORIGIN,
  JWXT_SSO_URL,
  userAgent
};
