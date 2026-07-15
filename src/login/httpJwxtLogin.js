const axios = require("axios");
const CryptoJS = require("crypto-js");

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

function isInvalidCredentialPage(html) {
  const text = String(html || "");
  return text.includes("用户名或密码") ||
    text.includes("账号或密码") ||
    text.includes("账户或密码") ||
    text.includes("密码错误") ||
    text.includes("用户名或密码") ||
    text.includes("账号或密码") ||
    text.includes("用户名不存在") ||
    text.includes("登录失败") ||
    text.includes("认证失败") ||
    text.toLowerCase().includes("invalid credentials");
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
  const containsCaptcha = includesAnyText(lower, [
    "captcha",
    "validatecode",
    "verifycode"
  ]) || includesAnyText(html, [
    "验证码",
    "楠岃瘉鐮"
  ]);
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
  console.log("URL: " + url);
  console.log("HTTP status: " + response.status);
  console.log("Location: " + (location || "(none)"));
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
  console.log("Final URL: " + finalUrl);
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

  const response = await axios({
    method,
    url,
    data: options && options.data,
    headers,
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: options && options.timeout ? options.timeout : 15000,
    responseType: options && options.responseType
  });

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

    const nextUrl = absoluteUrl(location, currentUrl);
    const previousUrl = currentUrl;
    currentUrl = nextUrl;
    urls.push(currentUrl);

    response = await requestNoRedirect(cookieJar, "GET", currentUrl, {
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
  return CryptoJS.DES.encrypt(password, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString();
}

async function checkCaptcha(cookieJar, studentId) {
  const url = CAS_ORIGIN + "/api/protected/user/findCaptchaCount/" + encodeURIComponent(studentId);
  const response = await requestNoRedirect(cookieJar, "GET", url, {
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
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (loginPage.status >= 500) {
    throwJwxtError("JWXT_UNAVAILABLE", "教务系统暂时不可用，请稍后再试", {
      portalStage: true,
      portalResult: portalDiagnostics(loginPage, LOGIN_URL)
    });
  }

  const html = String(loginPage.data || "");
  const execution = parseHiddenValue(html, "login-page-flowkey");
  const loginCroypto = parseHiddenValue(html, "login-croypto");
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

  const encryptedPassword = encryptPassword(loginCroypto, password);
  if (!encryptedPassword) throw new Error("DES password encryption failed.");

  const form = new URLSearchParams({
    username: studentId,
    password: encryptedPassword,
    type: "UsernamePassword",
    _eventId: "submit",
    geolocation: "",
    execution,
    captcha_code: "",
    croypto: loginCroypto
  }).toString();

  const loginResponse = await requestNoRedirect(cookieJar, "POST", LOGIN_POST_URL, {
    data: form,
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": CAS_ORIGIN,
      "Referer": LOGIN_URL
    }
  });

  if (loginResponse.status >= 500) {
    throwJwxtError("JWXT_UNAVAILABLE", "教务系统暂时不可用，请稍后再试", {
      portalStage: true,
      portalResult: portalDiagnostics(loginResponse, LOGIN_POST_URL)
    });
  }

  const followed = await followRedirects(cookieJar, loginResponse, LOGIN_POST_URL);
  if (followed.response && followed.response.status >= 500) {
    throwJwxtError("JWXT_UNAVAILABLE", "教务系统暂时不可用，请稍后再试", {
      portalStage: true,
      portalResult: portalDiagnostics(followed.response, followed.finalUrl)
    });
  }

  if (followed.finalUrl.includes(PORTAL_ORIGIN + "/sso/login?code=")) {
    return getAndFollow(cookieJar, followed.finalUrl, LOGIN_POST_URL);
  }
  if (isInvalidCredentialPage(followed.response && followed.response.data)) {
    throwJwxtError("JWXT_INVALID_CREDENTIALS", "学号或教务密码错误，请检查后重试", {
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
  isInvalidCredentialPage,
  findJwxtJSessionId,
  LOGIN_URL,
  LOGIN_POST_URL,
  CAS_ORIGIN,
  PORTAL_ORIGIN,
  JWXT_SSO_URL,
  userAgent
};
