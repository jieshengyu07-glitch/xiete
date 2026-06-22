const axios = require("axios");
const CryptoJS = require("crypto-js");
const readline = require("readline");

const CAS_ORIGIN = "https://sso1.tyust.edu.cn";
const PORTAL_ORIGIN = "https://ronghemenhu.tyust.edu.cn";
const SERVICE_URL =
  CAS_ORIGIN +
  "/oauth2.0/callbackAuthorize?client_id=rhmh" +
  "&redirect_uri=https%3A%2F%2Fronghemenhu.tyust.edu.cn%2Fsso%2Flogin" +
  "&response_type=code" +
  "&client_name=CasOAuthClient";
const LOGIN_URL = CAS_ORIGIN + "/login?service=" + encodeURIComponent(SERVICE_URL);
const LOGIN_POST_URL = CAS_ORIGIN + "/login";
const MAX_REDIRECTS = 20;

const cookieJar = [];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question);

  return new Promise(resolve => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(char) {
      if (char === "\r" || char === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u0003") {
        cleanup();
        stdout.write("\n");
        process.exit(130);
      }

      if (char === "\b" || char === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      value += char;
      stdout.write("*");
    }

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}

function parseHiddenValue(html, id) {
  const pattern = new RegExp("<[^>]+id=[\"']" + id + "[\"'][^>]*>([^<]*)<\\/[^>]+>", "i");
  const match = String(html || "").match(pattern);
  return match ? decodeHtml(match[1].trim()) : "";
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absoluteUrl(location, baseUrl) {
  return new URL(location, baseUrl).toString();
}

function hostnameOf(url) {
  return new URL(url).hostname;
}

function storeCookies(setCookieHeaders, responseUrl) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const host = hostnameOf(responseUrl);

  headers.forEach(header => {
    const first = String(header).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) return;

    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const domainMatch = String(header).match(/;\s*Domain=([^;]+)/i);
    const domain = domainMatch ? domainMatch[1].replace(/^\./, "").toLowerCase() : host.toLowerCase();

    const index = cookieJar.findIndex(c => c.name === name && c.domain === domain);
    const cookie = { name, value, domain };
    if (index >= 0) cookieJar[index] = cookie;
    else cookieJar.push(cookie);
  });
}

function setCookieNames(setCookieHeaders) {
  if (!setCookieHeaders) return [];
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return headers.map(header => String(header).split(";")[0].split("=")[0].trim()).filter(Boolean);
}

function cookieHeaderFor(url) {
  const host = hostnameOf(url).toLowerCase();
  const pairs = cookieJar
    .filter(cookie => host === cookie.domain || host.endsWith("." + cookie.domain))
    .map(cookie => cookie.name + "=" + cookie.value);
  return pairs.join("; ");
}

async function requestNoRedirect(method, url, options) {
  const headers = Object.assign({}, options && options.headers);
  const cookieHeader = cookieHeaderFor(url);
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await axios({
    method,
    url,
    data: options && options.data,
    headers,
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15000
  });

  storeCookies(response.headers["set-cookie"], url);
  return response;
}

function printHttpStep(url, response) {
  const location = response.headers && response.headers.location ? response.headers.location : "";
  const cookieNames = setCookieNames(response.headers && response.headers["set-cookie"]);

  console.log("\n[HTTP STEP]");
  console.log("URL: " + url);
  console.log("HTTP status: " + response.status);
  console.log("Location: " + (location || "(none)"));
  console.log("Set-Cookie names: " + (cookieNames.length ? cookieNames.join(", ") : "(none)"));
}

async function followRedirects(startResponse, startUrl, options) {
  let response = startResponse;
  let currentUrl = startUrl;
  const trace = Boolean(options && options.trace);

  if (trace) printHttpStep(currentUrl, response);

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const location = response.headers && response.headers.location;
    if (!location || response.status < 300 || response.status >= 400) break;

    const nextUrl = absoluteUrl(location, currentUrl);
    const previousUrl = currentUrl;
    currentUrl = nextUrl;
    response = await requestNoRedirect("GET", currentUrl, {
      headers: {
        "User-Agent": userAgent(),
        "Referer": previousUrl
      }
    });
    if (trace) printHttpStep(currentUrl, response);
  }

  return { response, finalUrl: currentUrl };
}

async function getAndFollow(url, referer) {
  const response = await requestNoRedirect("GET", url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": referer || LOGIN_URL
    }
  });
  return followRedirects(response, url, { trace: true });
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

function encryptPassword(loginCroypto, password) {
  const key = CryptoJS.enc.Base64.parse(loginCroypto);
  return CryptoJS.DES.encrypt(password, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString();
}

async function checkCaptcha(username) {
  const url = CAS_ORIGIN + "/api/protected/user/findCaptchaCount/" + encodeURIComponent(username);
  const response = await requestNoRedirect("GET", url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Referer": LOGIN_URL
    }
  });

  const data = response.data || {};
  return Boolean(data && data.data && data.data.captchaInvisible);
}

function hasPortalCookie() {
  return cookieJar.some(cookie => cookie.domain === "ronghemenhu.tyust.edu.cn");
}

function portalCookieNames() {
  return cookieJar
    .filter(cookie => cookie.domain === "ronghemenhu.tyust.edu.cn")
    .map(cookie => cookie.name);
}

function newjwcCookieNames() {
  return cookieJar
    .filter(cookie => cookie.domain === "newjwc.tyust.edu.cn")
    .map(cookie => cookie.name);
}

function isPortalCodeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "ronghemenhu.tyust.edu.cn" &&
      parsed.pathname === "/sso/login" &&
      parsed.searchParams.has("code");
  } catch (error) {
    return false;
  }
}

function isPortalSuccess(finalUrl) {
  return finalUrl.startsWith(PORTAL_ORIGIN + "/index") || hasPortalCookie();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractScriptUrls(html, baseUrl) {
  const urls = [];
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = pattern.exec(String(html || "")))) {
    try {
      const url = absoluteUrl(decodeHtml(match[1]), baseUrl);
      const parsed = new URL(url);
      if (parsed.hostname === "ronghemenhu.tyust.edu.cn" && parsed.pathname.endsWith(".js")) {
        urls.push(url);
      }
    } catch (error) {}
  }

  return unique(urls);
}

function extractSuspiciousUrls(text, baseUrl) {
  const urls = [];
  const pattern = /(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]+)/gi;
  let match;

  while ((match = pattern.exec(String(text || "")))) {
    const raw = decodeHtml(match[0]).replace(/[),.;]+$/, "");
    if (!isSuspiciousText(raw)) continue;
    try {
      urls.push(absoluteUrl(raw, baseUrl));
    } catch (error) {
      urls.push(raw);
    }
  }

  return unique(urls);
}

function isSuspiciousText(text) {
  const value = String(text || "").toLowerCase();
  return value.includes("newjwc") ||
    value.includes("jwglxt") ||
    value.includes("rjurl") ||
    String(text || "").includes("\u6559\u52a1") ||
    String(text || "").includes("\u6559\u5b66\u7ba1\u7406");
}

function suspiciousSnippets(text) {
  const lines = String(text || "").split(/\r?\n/);
  return lines
    .map(line => line.trim())
    .filter(line => line && isSuspiciousText(line))
    .map(line => line.length > 300 ? line.slice(0, 300) + "..." : line)
    .slice(0, 30);
}

async function searchPortalIndexForJwxt(indexHtml, indexUrl) {
  console.log("\n=== Search portal index for JWXT entry ===");

  const sources = [
    { url: indexUrl, text: String(indexHtml || "") }
  ];

  const scriptUrls = extractScriptUrls(indexHtml, indexUrl);
  console.log("Linked same-origin JS files: " + scriptUrls.length);

  for (const scriptUrl of scriptUrls) {
    try {
      const response = await requestNoRedirect("GET", scriptUrl, {
        headers: {
          "User-Agent": userAgent(),
          "Accept": "application/javascript,text/javascript,*/*;q=0.8",
          "Referer": indexUrl
        }
      });
      sources.push({ url: scriptUrl, text: String(response.data || "") });
    } catch (error) {
      console.log("JS fetch failed: " + scriptUrl + " (" + error.message + ")");
    }
  }

  const suspiciousUrls = [];
  const snippets = [];

  sources.forEach(source => {
    extractSuspiciousUrls(source.text, source.url).forEach(url => suspiciousUrls.push(url));
    suspiciousSnippets(source.text).forEach(snippet => {
      snippets.push({ source: source.url, snippet });
    });
  });

  const uniqueUrls = unique(suspiciousUrls);
  console.log("Suspicious URLs found: " + uniqueUrls.length);
  if (uniqueUrls.length) {
    uniqueUrls.slice(0, 50).forEach((url, index) => {
      console.log((index + 1) + ". " + url);
    });
  }

  console.log("Suspicious snippets found: " + snippets.length);
  snippets.slice(0, 30).forEach((item, index) => {
    console.log((index + 1) + ". source: " + item.source);
    console.log("   " + item.snippet);
  });

  if (!uniqueUrls.length && !snippets.length) {
    console.log("No JWXT entry was exposed in portal /index HTML or linked JS.");
    console.log("Need Playwright to capture the request URL when clicking the portal app named JWXT / teaching affairs.");
  }

  return { suspiciousUrls: uniqueUrls, snippets };
}

function printResult(result) {
  console.log("\n=== CAS HTTP Login Test Result ===");
  console.log("Needs captcha: " + (result.needsCaptcha ? "YES" : "NO"));
  console.log("Got execution: " + (result.gotExecution ? "YES" : "NO"));
  console.log("Got login-croypto: " + (result.gotLoginCroypto ? "YES" : "NO"));
  console.log("DES encryption completed: " + (result.desEncrypted ? "YES" : "NO"));
  console.log("Final URL: " + result.finalUrl);
  console.log("Got portal cookie: " + (result.gotPortalCookie ? "YES" : "NO"));
  console.log("Portal cookie names: " + (result.portalCookieNames.length ? result.portalCookieNames.join(", ") : "(none)"));
  console.log("Portal login success: " + (result.portalSuccess ? "YES" : "NO"));
  console.log("newjwc cookie names: " + (result.newjwcCookieNames.length ? result.newjwcCookieNames.join(", ") : "(none)"));
}

(async () => {
  const username = await ask("Student ID: ");
  const password = await askSecret("Password: ");

  const result = {
    needsCaptcha: false,
    gotExecution: false,
    gotLoginCroypto: false,
    desEncrypted: false,
    finalUrl: "",
    gotPortalCookie: false,
    portalCookieNames: [],
    portalSuccess: false,
    newjwcCookieNames: []
  };

  try {
    const loginPage = await requestNoRedirect("GET", LOGIN_URL, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const html = String(loginPage.data || "");
    const execution = parseHiddenValue(html, "login-page-flowkey");
    const loginCroypto = parseHiddenValue(html, "login-croypto");

    result.gotExecution = Boolean(execution);
    result.gotLoginCroypto = Boolean(loginCroypto);

    result.needsCaptcha = await checkCaptcha(username).catch(() => false);

    if (!execution || !loginCroypto) {
      result.finalUrl = LOGIN_URL;
      printResult(result);
      process.exitCode = 1;
      return;
    }

    if (result.needsCaptcha) {
      result.finalUrl = LOGIN_URL;
      printResult(result);
      process.exitCode = 2;
      return;
    }

    const encryptedPassword = encryptPassword(loginCroypto, password);
    result.desEncrypted = Boolean(encryptedPassword);

    const form = new URLSearchParams({
      username,
      password: encryptedPassword,
      type: "UsernamePassword",
      _eventId: "submit",
      geolocation: "",
      execution,
      captcha_code: "",
      croypto: loginCroypto
    }).toString();

    const loginResponse = await requestNoRedirect("POST", LOGIN_POST_URL, {
      data: form,
      headers: {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": CAS_ORIGIN,
        "Referer": LOGIN_URL
      }
    });

    console.log("\n=== Redirect trace: CAS login -> portal ===");
    let followed = await followRedirects(loginResponse, LOGIN_POST_URL, { trace: true });

    if (isPortalCodeUrl(followed.finalUrl)) {
      console.log("\n=== Extra GET: portal sso/login?code=... ===");
      followed = await getAndFollow(followed.finalUrl, LOGIN_POST_URL);
    }

    console.log("\n=== Final GET: portal index ===");
    const indexFollowed = await getAndFollow(PORTAL_ORIGIN + "/index", followed.finalUrl);

    result.finalUrl = indexFollowed.finalUrl;
    result.gotPortalCookie = hasPortalCookie();
    result.portalCookieNames = portalCookieNames();
    result.portalSuccess = isPortalSuccess(indexFollowed.finalUrl);
    await searchPortalIndexForJwxt(indexFollowed.response && indexFollowed.response.data, indexFollowed.finalUrl);
    result.newjwcCookieNames = newjwcCookieNames();

    printResult(result);

    if (!result.portalSuccess) process.exitCode = 1;
  } catch (error) {
    result.finalUrl = result.finalUrl || LOGIN_URL;
    printResult(result);
    console.error("\nERROR: " + error.message);
    process.exitCode = 1;
  }
})();
