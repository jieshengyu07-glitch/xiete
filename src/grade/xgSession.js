const cheerio = require("cheerio");
const crypto = require("crypto");
const credentialStore = require("../services/credentialStore");
const { httpPortalLogin, getAndFollow, requestNoRedirect, followRedirects, PORTAL_ORIGIN, userAgent } = require("../login/httpJwxtLogin");
const { queryXgScores } = require("./xgScoreQuery");

function safeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\u3000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const XG_ORIGIN = "https://xg.tyust.edu.cn";
const PORTAL_HOST = "ronghemenhu.tyust.edu.cn";
const SCORE_PAGE_NAME = "StuStudentScore.aspx";
const SUSPICIOUS_KEYWORDS = [
  "xg",
  "userhall",
  "app",
  "application",
  "学工",
  "综合测评",
  "score",
  "student",
  "judge",
  "menu",
  "applist",
  "appList",
  "application",
  "applications",
  "workbench",
  "workplace",
  "workhall",
  "myApp",
  "favoriteApp",
  "appCenter",
  "service",
  "serviceList",
  "portal",
  "redirect",
  "third",
  "ticket",
  "oauth",
  "sso",
  "学工",
  "学工管理",
  "学工一体化",
  "综合测评"
];

const PORTAL_API_KEYWORDS = [
  "axios",
  "baseurl",
  "request",
  "getapp",
  "applist",
  "application",
  "applications",
  "workbench",
  "workplace",
  "workhall",
  "menu",
  "usermenu",
  "myapp",
  "favoriteapp",
  "appcenter",
  "service",
  "servicelist",
  "portal",
  "oauth",
  "redirect",
  "third",
  "sso",
  "ticket",
  "xg.tyust.edu.cn",
  "学工管理",
  "学工一体化"
];

const APP_API_HINTS = [
  "app",
  "application",
  "service",
  "menu",
  "workplace",
  "workbench",
  "workhall",
  "myapp",
  "favorite",
  "appcenter",
  "portal"
];

const XG_APP_KEYWORDS = [
  "学工管理",
  "学工一体化平台",
  "xg.tyust.edu.cn",
  "userhall",
  "App_StudentJudge",
  "app_studentjudge",
  "综合测评"
];

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function pathMatches(requestPath, cookiePath) {
  return requestPath === cookiePath ||
    requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : cookiePath + "/");
}

function cookieHeaderFor(cookieJar, url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || "/";
  return (cookieJar || [])
    .filter(cookie => domainMatches(host, String(cookie.domain || "").toLowerCase()) && pathMatches(path, cookie.path || "/"))
    .map(cookie => cookie.name + "=" + cookie.value)
    .join("; ");
}

function sanitizeUrlForLog(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname;
  } catch (err) {
    return "unknown";
  }
}

function hostOf(url) {
  try {
    return new URL(String(url || "")).hostname;
  } catch (err) {
    return "";
  }
}

function safePathname(value) {
  try {
    const parsed = new URL(String(value || ""));
    const masked = parsed.pathname.replace(/\/\(S\([^/]+\)\)\//g, "/(S(**redacted**))/");
    return masked.length > 200 ? masked.slice(0, 200) + "..." : masked;
  } catch (err) {
    return "unknown";
  }
}

function safeMessage(err) {
  const code = err && (err.code || err.name) ? String(err.code || err.name) : "ERROR";
  return code.replace(/\s+/g, "_").slice(0, 80);
}

function isLoginTimeoutUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const path = String(parsed.pathname || "").toLowerCase();
    return path.includes("logintimeout") ||
      path.includes("errorpages/logintimeout") ||
      (parsed.hostname === "sso1.tyust.edu.cn" && path === "/logout");
  } catch (err) {
    return false;
  }
}

function isLoginTimeoutHtml(html) {
  const text = String(html || "").toLowerCase();
  return text.includes("logintimeout.html") ||
    text.includes("errorpages/logintimeout") ||
    String(html || "").includes("登录超时") ||
    text.includes("登录超时") ||
    text.includes("login timeout") ||
    text.includes("sso1.tyust.edu.cn/logout");
}

function isLoginTimeoutPage(page) {
  const html = page && page.response ? String(page.response.data || "") : "";
  return isLoginTimeoutUrl(page && page.finalUrl) || isLoginTimeoutHtml(html);
}

function isThirdpartyCasUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === "xg.tyust.edu.cn" &&
      parsed.pathname.toLowerCase() === "/userhall/login/thirdpartycas";
  } catch (err) {
    return false;
  }
}

function isChoosePersonUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === "xg.tyust.edu.cn" &&
      parsed.pathname.toLowerCase().includes("/userhall/login/chooseperson");
  } catch (err) {
    return false;
  }
}

function isIntermediateAuthUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const path = String(parsed.pathname || "").toLowerCase();
    return parsed.hostname === "sso1.tyust.edu.cn" &&
      (path.includes("/oauth2.0/authorize") || path.includes("/oauth2.0/callbackauthorize"));
  } catch (err) {
    return false;
  }
}

function isXgAuthUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname !== "xg.tyust.edu.cn") return false;
    const path = String(parsed.pathname || "").toLowerCase();
    return path.includes("/cas/onelogin.aspx") ||
      path.includes("/cas/login/index") ||
      path.includes("/userhall/login/thirdpartycas") ||
      path.includes("/userhall/login/chooseperson");
  } catch (err) {
    return false;
  }
}

function isXgHomeUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === "xg.tyust.edu.cn" &&
      String(parsed.pathname || "").toLowerCase() === "/userhall/sec/page/index";
  } catch (err) {
    return false;
  }
}

function xgCookieCount(cookieJar) {
  return (cookieJar || []).filter(cookie => String(cookie.domain || "").toLowerCase() === "xg.tyust.edu.cn").length;
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(String(href || ""), baseUrl).toString();
  } catch (err) {
    return "";
  }
}

function isNormalUrlRef(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (!text || text.length > 500) return false;
  if (text.includes("<") || text.includes(">") || lower.includes("%3c") || lower.includes("%3e")) return false;
  return text.startsWith("http://") || text.startsWith("https://") || text.startsWith("/");
}

function isLikelyCss(url) {
  try {
    return new URL(String(url || "")).pathname.toLowerCase().endsWith(".css");
  } catch (err) {
    return false;
  }
}

function isLikelyJs(url) {
  try {
    return new URL(String(url || "")).pathname.toLowerCase().endsWith(".js");
  } catch (err) {
    return false;
  }
}

function isPortalHost(url) {
  return hostOf(url) === PORTAL_HOST;
}

function responseText(response) {
  const data = response && response.data;
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data || "");
  } catch (err) {
    return "";
  }
}

function containsXgAppKeyword(text) {
  const lower = String(text || "").toLowerCase();
  return XG_APP_KEYWORDS.some(keyword => lower.includes(String(keyword).toLowerCase()));
}

function collectLinks(html, baseUrl, predicate) {
  const $ = cheerio.load(String(html || ""));
  const links = [];
  $("a[href], iframe[src], frame[src], form[action], area[href]").each((_, el) => {
    const raw = $(el).attr("href") || $(el).attr("src") || $(el).attr("action") || "";
    const url = absoluteUrl(raw, baseUrl);
    if (url && predicate(url, $(el).text() || "")) links.push(url);
  });
  return Array.from(new Set(links));
}

function collectPortalRefs(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const refs = [];
  const add = (type, raw) => {
    if (!isNormalUrlRef(raw)) return;
    const url = absoluteUrl(raw, baseUrl);
    if (url) refs.push({ type, url });
  };

  $("a[href]").each((_, el) => add("a", $(el).attr("href")));
  $("script[src]").each((_, el) => add("script", $(el).attr("src")));
  $("link[href]").each((_, el) => add("link", $(el).attr("href")));
  $("form[action]").each((_, el) => add("form", $(el).attr("action")));

  const seen = new Set();
  return refs.filter(ref => {
    const key = ref.type + "|" + ref.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSuspiciousRefs(html, baseUrl) {
  return Array.from(new Set(
    collectPortalRefs(html, baseUrl)
      .map(ref => ref.url)
      .filter(url => {
        const lower = url.toLowerCase();
        if (isLikelyCss(url)) return false;
        return SUSPICIOUS_KEYWORDS.some(keyword => lower.includes(String(keyword).toLowerCase()));
      })
  ));
}

function xgUrlsFromText(text, baseUrl) {
  const urls = [];
  const raw = String(text || "");
  const absolutePattern = /https?:\/\/xg\.tyust\.edu\.cn[^"'<>\s\\)]*/ig;
  let match;
  while ((match = absolutePattern.exec(raw))) urls.push(match[0]);

  const relativePattern = /["']([^"']*(?:userhall|App_StudentJudge|app_studentjudge|StudentJudge|StuStudentScore|Application\.aspx)[^"']*)["']/ig;
  while ((match = relativePattern.exec(raw))) {
    const url = absoluteUrl(match[1], baseUrl);
    if (hostOf(url) === "xg.tyust.edu.cn") urls.push(url);
  }
  return Array.from(new Set(urls));
}

function collectPortalJsUrls(html, baseUrl) {
  return Array.from(new Set(
    collectPortalRefs(html, baseUrl)
      .filter(ref => ref.type === "script" && isLikelyJs(ref.url) && isPortalHost(ref.url))
      .map(ref => ref.url)
  ));
}

function extractQuotedStrings(text) {
  const values = [];
  const pattern = /["'`]([^"'`]{1,500})["'`]/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    const value = match[1].trim();
    if (value) values.push(value);
  }
  return values;
}

function isPortalApiPath(value) {
  const text = String(value || "").trim();
  if (!isNormalUrlRef(text)) return false;
  if (text.startsWith("http://") || text.startsWith("https://")) {
    return hostOf(text) === PORTAL_HOST;
  }
  return /^\/(?:api|portal|application|applications|app|service|menu|workplace|workbench|workhall|oauth|third|user|sys|index)(?:[/?#]|$)/i.test(text);
}

function portalApiScore(url) {
  const lower = String(url || "").toLowerCase();
  let score = 0;
  APP_API_HINTS.forEach(hint => {
    if (lower.includes(hint)) score += 2;
  });
  if (lower.includes("list")) score += 2;
  if (lower.includes("tree")) score += 1;
  if (lower.includes("all")) score += 1;
  if (lower.includes("css")) score -= 5;
  return score;
}

function extractPortalApiCandidates(text, baseUrl) {
  const candidates = [];
  extractQuotedStrings(text).forEach(value => {
    const lower = value.toLowerCase();
    const hasApiKeyword = PORTAL_API_KEYWORDS.some(keyword => lower.includes(String(keyword).toLowerCase()));
    if (!isPortalApiPath(value) && !hasApiKeyword) return;
    if (!isPortalApiPath(value)) return;
    const url = absoluteUrl(value, baseUrl);
    if (url && isPortalHost(url) && !isLikelyCss(url)) candidates.push(url);
  });
  const pathPattern = /\/(?:api|portal|application|applications|app|service|menu|workplace|workbench|workhall|oauth|third|user|sys|index)\/[A-Za-z0-9_./-]*/ig;
  let match;
  while ((match = pathPattern.exec(String(text || "")))) {
    const url = absoluteUrl(match[0], baseUrl);
    if (url && isPortalHost(url) && !isLikelyCss(url)) candidates.push(url);
  }
  return Array.from(new Set(candidates))
    .sort((a, b) => portalApiScore(b) - portalApiScore(a));
}

function isPortalSsoReUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === PORTAL_HOST && parsed.pathname === "/portal/sso/re";
  } catch (err) {
    return false;
  }
}

function isAppListCandidate(url) {
  if (isPortalSsoReUrl(url)) return false;
  const lower = safePathname(url).toLowerCase();
  if (/(\/del|\/delete|\/save|\/update|\/remove|\/set)/i.test(lower)) return false;
  return [
    "applist",
    "application",
    "service",
    "menu",
    "workplace",
    "workbench",
    "workhall",
    "myapp",
    "favorite",
    "collect",
    "tyust",
    "working",
    "list",
    "page",
    "getkd",
    "myotherapplication"
  ].some(keyword => lower.includes(keyword));
}

function collectChunkJsUrlsFromText(text, baseUrl) {
  const urls = [];
  const pattern = /["'`]([^"'`]*(?:Workplace|workplace|workhall|third)[^"'`]*\.js)["'`]/ig;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    const value = match[1].replace(/^\.\//, "/");
    const url = absoluteUrl(value.startsWith("/") ? value : "/" + value, baseUrl);
    if (url && isPortalHost(url) && isLikelyJs(url)) urls.push(url);
  }
  const generic = /(?:\/js\/[^"'`\s\\)]+\.js)/ig;
  while ((match = generic.exec(String(text || "")))) {
    const value = match[0];
    if (!/(workplace|workhall|third)/i.test(value)) continue;
    const url = absoluteUrl(value, baseUrl);
    if (url && isPortalHost(url) && isLikelyJs(url)) urls.push(url);
  }
  const chunkMap = /["'`]([^"'`]*(?:Workplace|workplace|workhall|third)[^"'`]*)["'`]\s*:\s*["'`]([a-f0-9]{8,})["'`]/ig;
  while ((match = chunkMap.exec(String(text || "")))) {
    const name = match[1].replace(/^\.\//, "").replace(/^js\//, "");
    const hash = match[2];
    const url = absoluteUrl("/js/" + name + "." + hash + ".js", baseUrl);
    if (url && isPortalHost(url) && isLikelyJs(url)) urls.push(url);
  }
  ["Workplace", "third", "workhall", "workplace"].forEach(name => {
    const hashPattern = new RegExp("[\"']?" + name + "[\"']?\\s*:\\s*[\"']([a-f0-9]{8,})[\"']", "i");
    const hashMatch = String(text || "").match(hashPattern);
    if (!hashMatch) return;
    const url = absoluteUrl("/js/" + name + "." + hashMatch[1] + ".js", baseUrl);
    if (url && isPortalHost(url) && isLikelyJs(url)) urls.push(url);
  });
  return Array.from(new Set(urls));
}

function extractParamKeysFromObjectSnippet(snippet) {
  const keys = [];
  const keyPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let match;
  while ((match = keyPattern.exec(String(snippet || "")))) {
    const key = match[1];
    if (["url", "method", "params", "data", "headers", "then", "catch"].includes(key)) continue;
    keys.push(key);
  }
  return keys;
}

function sanitizeJsContextForLog(context) {
  return String(context || "")
    .replace(/["'`][\s\S]*?["'`]/g, "\"STR\"")
    .replace(/\b[0-9a-f]{24,}\b/ig, "HEX")
    .replace(/\b\d{4,}\b/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, 900);
}

function logEndpointContext(endpoint, context) {
  if (!/\/userhall\/api\/(?:omni\/get\/jump\/url|home\/service\/detail|home\/service\/get\/all)/i.test(endpoint)) return;
  console.log("[xg-session] step=xg-api-call-context pathname=" + endpoint +
    " snippet=" + sanitizeJsContextForLog(context));
}

function sanitizeJsExpression(expression) {
  const text = String(expression || "").trim();
  if (!text) return "unknown";
  if (/^["'`]/.test(text)) return "string-literal";
  const cleaned = text
    .replace(/\s+/g, "")
    .replace(/[()[\]]/g, "")
    .replace(/[^A-Za-z0-9_.$]/g, "");
  return cleaned.slice(0, 80) || "unknown";
}

function extractSsoCallExpressions(context) {
  const snippets = [];
  const paramsMatch = String(context || "").match(/params\s*:\s*\{([^}]{0,1200})\}/i);
  if (paramsMatch) snippets.push(paramsMatch[1]);
  const dataMatch = String(context || "").match(/data\s*:\s*\{([^}]{0,1200})\}/i);
  if (dataMatch) snippets.push(dataMatch[1]);
  const objectMatch = String(context || "").match(/\{\s*url\s*:\s*[^}]{0,1000}code\s*:\s*[^}]{0,1000}\}/i);
  if (objectMatch) snippets.push(objectMatch[0]);

  const result = { url: "unknown", code: "unknown" };
  snippets.forEach(snippet => {
    if (result.url === "unknown") {
      const match = snippet.match(/\burl\s*:\s*([^,}]+)/i);
      if (match) result.url = sanitizeJsExpression(match[1]);
    }
    if (result.code === "unknown") {
      const match = snippet.match(/\bcode\s*:\s*([^,}]+)/i);
      if (match) result.code = sanitizeJsExpression(match[1]);
    }
  });
  return result;
}

function analyzeRedirectUrlExpressions(jsTexts) {
  const raw = jsTexts.map(text => String(text || "")).join("\n");
  const callHasAppFields = /redirectUrl\([^)]*\.innerOrOuter\s*,\s*[^)]*\.appUrl\s*,\s*[^)]*\.name\s*,\s*[^)]*\.rjurl\s*\)/.test(raw);
  const methodUsesRjurlFirst = /redirectUrl\([^)]*\)\{if\(1==[^)]*\)[^?]+\?window\.open\([^|)]*\|\|[^)]*\):window\.open\([^|)]*\|\|[^)]*\)/.test(raw) ||
    /redirectUrl\([^)]*\)\{if\(1==[^)]*\)[\s\S]{0,300}window\.open\([^)]*rjurl[^)]*\)/i.test(raw);
  if (callHasAppFields) {
    return {
      found: true,
      url: methodUsesRjurlFirst ? "arg4.rjurl||arg2.appUrl" : "arg2.appUrl,arg4.rjurl",
      code: "not-used-by-redirectUrl",
      externalBranch: "innerOrOuter==1",
      externalAction: "window.open",
      externalUrlSource: "rjurl||appUrl",
      internalBranch: "innerOrOuter!=1",
      internalAction: "router.push",
      internalUrlSource: "appUrl",
      checks: "innerOrOuter,appUrl,rjurl,name"
    };
  }
  return { found: false, url: "unknown", code: "unknown" };
}

function analyzePortalSsoCall(jsTexts) {
  const knownParamKeys = [
    "appId",
    "applicationId",
    "serviceId",
    "thirdId",
    "targetUrl",
    "redirectUrl",
    "url",
    "code",
    "id",
    "appCode",
    "serviceCode"
  ];
  const analyses = [];

  jsTexts.forEach(text => {
    const raw = String(text || "");
    let index = raw.indexOf("/portal/sso/re");
    while (index >= 0) {
      const context = raw.slice(Math.max(0, index - 3000), Math.min(raw.length, index + 3000));
      const lower = context.toLowerCase();
      let method = "UNKNOWN";
      if (/method\s*:\s*["']post["']/i.test(context) || /\.post\s*\(/i.test(context) || /post\s*\(/i.test(context)) method = "POST";
      else if (/method\s*:\s*["']get["']/i.test(context) || /\.get\s*\(/i.test(context) || /get\s*\(/i.test(context)) method = "GET";

      const keys = new Set();
      knownParamKeys.forEach(key => {
        if (new RegExp("\\b" + key + "\\b", "i").test(context)) keys.add(key);
      });

      const paramsMatch = context.match(/params\s*:\s*\{([^}]{0,1000})\}/i);
      if (paramsMatch) extractParamKeysFromObjectSnippet(paramsMatch[1]).forEach(key => keys.add(key));
      const dataMatch = context.match(/data\s*:\s*\{([^}]{0,1000})\}/i);
      if (dataMatch) extractParamKeysFromObjectSnippet(dataMatch[1]).forEach(key => keys.add(key));
      const expressions = extractSsoCallExpressions(context);

      analyses.push({
        method,
        paramKeys: Array.from(keys),
        jsUrlExpression: expressions.url,
        jsCodeExpression: expressions.code,
        hasWindowOpen: lower.includes("window.open"),
        hasLocationHref: lower.includes("location.href") || lower.includes("window.location")
      });
      index = raw.indexOf("/portal/sso/re", index + 1);
    }
  });

  const best = analyses.find(item => item.method !== "UNKNOWN" && item.paramKeys.length) ||
    analyses.find(item => item.method !== "UNKNOWN") ||
    analyses[0] ||
    { method: "UNKNOWN", paramKeys: [] };
  const redirectExpressions = analyzeRedirectUrlExpressions(jsTexts);
  if ((!best.jsUrlExpression || best.jsUrlExpression === "unknown") && redirectExpressions.url !== "unknown") {
    best.jsUrlExpression = redirectExpressions.url;
  }
  if ((!best.jsCodeExpression || best.jsCodeExpression === "unknown") && redirectExpressions.code !== "unknown") {
    best.jsCodeExpression = redirectExpressions.code;
  }
  console.log("[portal-launch] step=analyze-sso-call method=" + best.method +
    " paramKeys=" + (best.paramKeys.length ? best.paramKeys.join(",") : "none") +
    " occurrences=" + analyses.length);
  console.log("[portal-launch] jsUrlExpression=" + (best.jsUrlExpression || "unknown"));
  console.log("[portal-launch] jsCodeExpression=" + (best.jsCodeExpression || "unknown"));
  return best;
}

function logPortalApiCandidates(candidates) {
  console.log("[portal-api] step=candidate count=" + candidates.length);
  candidates.slice(0, 30).forEach(url => {
    console.log("[portal-api] candidate=" + safePathname(url));
  });
}

function extractBaseUrlHints(text, baseUrl) {
  const hints = [];
  const pattern = /baseURL\s*[:=]\s*["'`]([^"'`]{1,300})["'`]/ig;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    if (!isNormalUrlRef(match[1])) continue;
    const url = absoluteUrl(match[1], baseUrl);
    if (url) hints.push(url);
  }
  return Array.from(new Set(hints));
}

function extractUrlsFromString(value, baseUrl) {
  const urls = [];
  const text = String(value || "").replace(/&amp;/g, "&");
  const absolutePattern = /https?:\/\/[^"'<>\s\\)]{1,500}/ig;
  let match;
  while ((match = absolutePattern.exec(text))) {
    const raw = match[0];
    if (isNormalUrlRef(raw)) urls.push(raw);
  }
  if (isNormalUrlRef(text)) {
    const url = absoluteUrl(text, baseUrl);
    if (url) urls.push(url);
  }
  return Array.from(new Set(urls));
}

function thirdpartyCasUrlsFromText(text, baseUrl) {
  const urls = [];
  const raw = String(text || "");
  const variants = [raw];
  try {
    variants.push(decodeURIComponent(raw));
  } catch (err) {}
  variants.forEach(value => extractUrlsFromString(value, baseUrl).forEach(url => {
    if (isThirdpartyCasUrl(url)) urls.push(url);
  }));
  extractQuotedStrings(raw).forEach(value => {
    const url = absoluteUrl(value.replace(/&amp;/g, "&"), baseUrl);
    if (isThirdpartyCasUrl(url)) urls.push(url);
  });
  return Array.from(new Set(urls));
}

function extractHtmlRedirectUrls(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];

  $("meta[http-equiv]").each((_, el) => {
    const equiv = String($(el).attr("http-equiv") || "").toLowerCase();
    const content = String($(el).attr("content") || "");
    if (equiv !== "refresh") return;
    const match = content.match(/url\s*=\s*([^;]+)/i);
    if (match) {
      const url = absoluteUrl(match[1].trim().replace(/^["']|["']$/g, ""), baseUrl);
      if (url) urls.push(url);
    }
  });

  $("form[action], a[href]").each((_, el) => {
    const raw = $(el).attr("action") || $(el).attr("href") || "";
    const url = absoluteUrl(raw, baseUrl);
    if (url && hostOf(url) === "xg.tyust.edu.cn") urls.push(url);
  });

  const scriptPattern = /(?:location(?:\.href)?|window\.location|location\.replace)\s*(?:=|\()\s*["']([^"']{1,500})["']/ig;
  let match;
  while ((match = scriptPattern.exec(String(html || "")))) {
    const url = absoluteUrl(match[1].replace(/&amp;/g, "&"), baseUrl);
    if (url && hostOf(url) === "xg.tyust.edu.cn") urls.push(url);
  }

  return Array.from(new Set(urls));
}

function extractAnyHtmlRedirectUrls(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];

  $("meta[http-equiv]").each((_, el) => {
    const equiv = String($(el).attr("http-equiv") || "").toLowerCase();
    const content = String($(el).attr("content") || "");
    if (equiv !== "refresh") return;
    const match = content.match(/url\s*=\s*([^;]+)/i);
    if (!match) return;
    const url = absoluteUrl(match[1].trim().replace(/^["']|["']$/g, "").replace(/&amp;/g, "&"), baseUrl);
    if (url) urls.push(url);
  });

  $("form[action], a[href]").each((_, el) => {
    const raw = $(el).attr("action") || $(el).attr("href") || "";
    const url = absoluteUrl(String(raw || "").replace(/&amp;/g, "&"), baseUrl);
    if (url) urls.push(url);
  });

  const patterns = [
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']{1,500})["']/ig,
    /location\.replace\s*\(\s*["']([^"']{1,500})["']\s*\)/ig,
    /window\.open\s*\(\s*["']([^"']{1,500})["']/ig
  ];
  const text = String(html || "");
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text))) {
      const url = absoluteUrl(match[1].replace(/&amp;/g, "&"), baseUrl);
      if (url) urls.push(url);
    }
  });

  encodedTextVariants(text).forEach(variant => {
    extractUrlsFromString(variant, baseUrl).forEach(url => urls.push(url));
  });

  return Array.from(new Set(urls)).filter(url => {
    const host = hostOf(url);
    return host === "xg.tyust.edu.cn" || host === "sso1.tyust.edu.cn" || host === PORTAL_HOST;
  });
}

function appRecordName(record) {
  const keys = ["name", "title", "appName", "serviceName", "applicationName", "menuName", "label"];
  for (const key of keys) {
    if (record && typeof record[key] === "string" && record[key].trim()) return record[key].trim().slice(0, 60);
  }
  return "unknown";
}

function appRecordTargetUrls(record, baseUrl) {
  const keys = ["targetUrl", "redirectUrl", "ssoUrl", "url", "href", "link", "action", "appUrl", "serviceUrl"];
  const urls = [];
  keys.forEach(key => {
    if (record && typeof record[key] === "string") {
      urls.push(...extractUrlsFromString(record[key], baseUrl));
    }
  });
  Object.keys(record || {}).forEach(key => {
    const value = record[key];
    if (typeof value !== "string") return;
    const lowerKey = key.toLowerCase();
    const lowerValue = value.toLowerCase();
    if (lowerKey.includes("url") || lowerKey.includes("href") || lowerKey.includes("link") ||
      lowerValue.includes("xg.tyust.edu.cn") || lowerValue.includes("userhall") || lowerValue.includes("app_studentjudge")) {
      urls.push(...extractUrlsFromString(value, baseUrl));
    }
  });
  return Array.from(new Set(urls));
}

function findXgAppRecords(data, baseUrl) {
  const records = [];
  const seen = new Set();

  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const strings = Object.keys(value)
      .filter(key => typeof value[key] === "string")
      .map(key => value[key]);
    const haystack = strings.join(" ").toLowerCase();
    const matched = XG_APP_KEYWORDS.some(keyword => haystack.includes(String(keyword).toLowerCase()));
    if (matched) {
      const key = JSON.stringify(strings.slice(0, 12));
      if (!seen.has(key)) {
        seen.add(key);
        records.push({
          name: appRecordName(value),
          targetUrls: appRecordTargetUrls(value, baseUrl),
          raw: value
        });
      }
    }

    Object.keys(value).forEach(key => walk(value[key]));
  };

  walk(data);
  return records;
}

function parseJsonMaybe(data) {
  if (!data) return null;
  if (typeof data === "object") return data;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function getPortalResource(cookieJar, url, referer) {
  const response = await requestNoRedirect(cookieJar, "GET", url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Referer": referer || PORTAL_ORIGIN + "/index",
      "X-Requested-With": "XMLHttpRequest"
    },
    timeout: 20000
  });
  return followRedirects(cookieJar, response, url);
}

async function ensurePortalApiSession(cookieJar, portalBase) {
  let oauthCode = "";
  try {
    oauthCode = new URL(String(portalBase || "")).searchParams.get("code") || "";
  } catch (err) {}
  if (!oauthCode) {
    const authUrls = [
      "https://sso1.tyust.edu.cn/oauth2.0/authorize?response_type=code&client_id=rhmh&redirect_uri=http%3A%2F%2F210.31.104.43%3A80%2Fsso%2Flogin",
      "https://sso1.tyust.edu.cn/oauth2.0/authorize?response_type=code&client_id=rhmh&redirect_uri=https%3A%2F%2Fronghemenhu.tyust.edu.cn%2Fsso%2Flogin"
    ];
    for (const authUrl of authUrls) {
      const authPage = await getPage(cookieJar, authUrl, portalBase || PORTAL_ORIGIN + "/index").catch(err => {
        console.log("[portal-api] step=oauth-code-failed code=" + safeMessage(err));
        return null;
      });
      const urls = authPage && Array.isArray(authPage.urls) ? authPage.urls : [];
      const codeUrl = urls.concat(authPage && authPage.finalUrl ? [authPage.finalUrl] : []).find(url => {
        try {
          return Boolean(new URL(String(url || "")).searchParams.get("code"));
        } catch (err) {
          return false;
        }
      });
      try {
        oauthCode = codeUrl ? (new URL(codeUrl).searchParams.get("code") || "") : "";
      } catch (err) {}
      console.log("[portal-api] step=oauth-code status=" + (authPage && authPage.response ? authPage.response.status : "none") +
        " finalHost=" + (authPage ? sanitizeUrlForLog(authPage.finalUrl) : "unknown") +
        " hasCode=" + Boolean(oauthCode));
      if (oauthCode) break;
    }
  }
  if (oauthCode) {
    const response = await requestNoRedirect(cookieJar, "POST", PORTAL_ORIGIN + "/portal/publish/web/login/loginByOauth", {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        "Referer": portalBase || PORTAL_ORIGIN + "/sso/login",
        "X-Requested-With": "XMLHttpRequest"
      },
      data: { code: oauthCode, username: "", password: "" },
      timeout: 20000
    }).catch(err => {
      console.log("[portal-api] step=oauth-login-failed code=" + safeMessage(err));
      return null;
    });
    console.log("[portal-api] step=oauth-login hasCode=true status=" + (response ? response.status : "none"));
  } else {
    console.log("[portal-api] step=oauth-login hasCode=false status=skipped");
  }

  const warmups = [
    PORTAL_ORIGIN + "/portal/publish/web/login/user",
    PORTAL_ORIGIN + "/portal/publish/user/getCurrentUserInfo"
  ];
  for (const url of warmups) {
    const page = await getPortalResource(cookieJar, url, portalBase).catch(err => {
      console.log("[portal-api] step=session-warmup-failed code=" + safeMessage(err));
      return null;
    });
    console.log("[portal-api] step=session-warmup host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url) +
      " status=" + (page && page.response ? page.response.status : "none"));
  }
  return oauthCode;
}

async function requestPortalLaunch(cookieJar, url, method, payload, referer) {
  const upper = String(method || "GET").toUpperCase();
  const headers = {
    "User-Agent": userAgent(),
    "Accept": "application/json, text/plain, */*",
    "Referer": referer || PORTAL_ORIGIN + "/index",
    "X-Requested-With": "XMLHttpRequest"
  };
  let requestUrl = url;
  let data = undefined;

  if (upper === "GET") {
    const parsed = new URL(url);
    Object.keys(payload || {}).forEach(key => parsed.searchParams.set(key, payload[key]));
    requestUrl = parsed.toString();
  } else {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    data = payload || {};
  }

  const response = await requestNoRedirect(cookieJar, upper, requestUrl, {
    headers,
    data,
    timeout: 20000
  });
  return { response, requestUrl };
}

function safeHostPath(value) {
  return {
    host: sanitizeUrlForLog(value),
    pathname: safePathname(value)
  };
}

function contentTypeOf(response) {
  return String((response && response.headers && response.headers["content-type"]) || "").split(";")[0].trim();
}

function jsonTopKeys(data) {
  const json = parseJsonMaybe(data);
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  return Object.keys(json).slice(0, 40);
}

function collectObjectKeys(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => collectObjectKeys(item, out));
    return;
  }
  Object.keys(value).forEach(key => {
    out.add(key);
    collectObjectKeys(value[key], out);
  });
}

function collectStringValues(value, out) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, out));
    return;
  }
  Object.keys(value).forEach(key => collectStringValues(value[key], out));
}

function encodedTextVariants(text) {
  const raw = String(text || "");
  const variants = [raw];
  try {
    variants.push(decodeURIComponent(raw));
  } catch (err) {}
  try {
    variants.push(JSON.parse('"' + raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'));
  } catch (err) {}
  return Array.from(new Set(variants));
}

function extractLaunchUrl(response, baseUrl) {
  const location = response && response.headers && response.headers.location;
  if (location) {
    const url = absoluteUrl(location, baseUrl);
    if (isThirdpartyCasUrl(url) || hostOf(url) === "xg.tyust.edu.cn") return url;
  }

  const data = response ? response.data : "";
  const json = parseJsonMaybe(data);
  const stringValues = [];
  if (json) collectStringValues(json, stringValues);

  stringValues.forEach(value => {
    encodedTextVariants(value).forEach(text => {
      const found = thirdpartyCasUrlsFromText(text, baseUrl)[0];
      if (found) stringValues.push("__FOUND__" + found);
    });
  });
  const jsonFound = stringValues.find(value => String(value).startsWith("__FOUND__"));
  if (jsonFound) return jsonFound.slice("__FOUND__".length);

  const html = responseText(response);
  const htmlUrls = extractHtmlRedirectUrls(html, baseUrl)
    .concat(thirdpartyCasUrlsFromText(html, baseUrl));
  const htmlFound = htmlUrls.find(url => isThirdpartyCasUrl(url) || hostOf(url) === "xg.tyust.edu.cn");
  if (htmlFound) return htmlFound;

  for (const variant of encodedTextVariants(html)) {
    const found = thirdpartyCasUrlsFromText(variant, baseUrl)[0];
    if (found) return found;
  }
  return "";
}

function logPortalLaunchResponse(response, requestUrl) {
  const status = response ? response.status : "none";
  const type = contentTypeOf(response);
  const location = response && response.headers ? response.headers.location : "";
  const locationUrl = location ? absoluteUrl(location, requestUrl) : "";
  const locationParts = safeHostPath(locationUrl);
  console.log("[portal-launch] step=sso-raw status=" + status +
    " contentType=" + (type || "none") +
    " hasLocation=" + Boolean(location) +
    " locationHost=" + (location ? locationParts.host : "none") +
    " locationPathname=" + (location ? locationParts.pathname : "none"));

  const text = responseText(response);
  const json = parseJsonMaybe(response && response.data);
  const keys = new Set();
  collectObjectKeys(json, keys);
  const decoded = encodedTextVariants(text).join("\n");
  console.log("[portal-launch] step=sso-result status=" + (response ? response.status : "none"));
  console.log("[portal-launch] step=sso-body contentType=" + (type || "none") +
    " bodyLength=" + text.length +
    " isJson=" + Boolean(json) +
    " topKeys=" + (jsonTopKeys(response && response.data).join(",") || "none") +
    " hasUrlKey=" + keys.has("url") +
    " hasRedirectUrlKey=" + keys.has("redirectUrl") +
    " hasTargetUrlKey=" + keys.has("targetUrl") +
    " hasLocationKey=" + keys.has("location") +
    " hasHrefKey=" + keys.has("href") +
    " containsXg=" + decoded.includes("xg.tyust.edu.cn") +
    " containsThirdpartycas=" + decoded.toLowerCase().includes("thirdpartycas") +
    " hasWindowLocation=" + /window\.location|location\.href|location\.replace/i.test(decoded) +
    " hasWindowOpen=" + /window\.open/i.test(decoded) +
    " hasMetaRefresh=" + /http-equiv=["']?refresh/i.test(decoded) +
    " hasFormAction=" + /<form[^>]+action=/i.test(decoded) +
    " hasHref=" + /href\s*=/i.test(decoded));
}

function setCookieCount(response) {
  const value = response && response.headers && response.headers["set-cookie"];
  if (!value) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function looksLikeSsoLoginPage(html, finalUrl) {
  const text = String(html || "");
  const lower = text.toLowerCase();
  const path = safePathname(finalUrl).toLowerCase();
  if (hostOf(finalUrl) !== "sso1.tyust.edu.cn") return false;
  return path.includes("/login") ||
    lower.includes("login-page-flowkey") ||
    lower.includes("login-croypto") ||
    lower.includes("password") ||
    lower.includes("type=\"password\"") ||
    text.includes("统一身份认证") ||
    text.includes("用户登录") ||
    text.includes("密码登录");
}

function portalOauthCodeFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname !== PORTAL_HOST || String(parsed.pathname || "").toLowerCase() !== "/sso/login") return "";
    return parsed.searchParams.get("code") || "";
  } catch (err) {
    return "";
  }
}

async function consumePortalOauthCallback(cookieJar, callbackUrl, referer) {
  const code = portalOauthCodeFromUrl(callbackUrl);
  console.log("[portal-launch] step=portal-oauth-callback hasCode=" + Boolean(code));
  if (!code) return false;
  const response = await requestNoRedirect(cookieJar, "POST", PORTAL_ORIGIN + "/portal/publish/web/login/loginByOauth", {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      "Referer": referer || callbackUrl,
      "X-Requested-With": "XMLHttpRequest"
    },
    data: { code, username: "", password: "" },
    timeout: 20000
  }).catch(err => {
    console.log("[portal-launch] step=portal-oauth-login-failed code=" + safeMessage(err));
    return null;
  });
  console.log("[portal-launch] step=portal-oauth-login status=" + (response ? response.status : "none"));
  return Boolean(response && response.status >= 200 && response.status < 300);
}

function inspectAuthorizeLocation(authorizeUrl, options) {
  const portalDiagnosis = options && options.portalDiagnosis ? options.portalDiagnosis : "portal-oauth-loop";
  let result = {
    isAuthorize: false,
    authorizeRedirectHost: "unknown",
    authorizeRedirectPathname: "unknown",
    diagnosis: "",
    oauthLoopDetected: false
  };
  try {
    const parsed = new URL(String(authorizeUrl || ""));
    const path = String(parsed.pathname || "").toLowerCase();
    if (parsed.hostname !== "sso1.tyust.edu.cn" || !path.includes("/oauth2.0/authorize")) return result;
    const queryKeys = Array.from(new Set(Array.from(parsed.searchParams.keys())))
      .filter(key => !/^(code|ticket|token|tk)$/i.test(key));
    const redirectUri = parsed.searchParams.get("redirect_uri") || "";
    let redirectHost = "unknown";
    let redirectPathname = "unknown";
    if (redirectUri) {
      try {
        const redirect = new URL(redirectUri);
        redirectHost = redirect.hostname || "unknown";
        redirectPathname = safePathname(redirect.toString());
      } catch (err) {}
    }
    const responseType = parsed.searchParams.get("response_type") || "none";
    console.log("[portal-launch] step=inspect-authorize" +
      " queryKeys=" + (queryKeys.length ? queryKeys.join(",") : "none") +
      " redirectUriPresent=" + Boolean(redirectUri) +
      " redirectUriHost=" + redirectHost +
      " redirectUriPathname=" + redirectPathname +
      " clientIdPresent=" + parsed.searchParams.has("client_id") +
      " statePresent=" + parsed.searchParams.has("state") +
      " responseType=" + sanitizeJsExpression(responseType));

    result = {
      isAuthorize: true,
      authorizeRedirectHost: redirectHost,
      authorizeRedirectPathname: redirectPathname,
      diagnosis: "",
      oauthLoopDetected: false
    };
    if (redirectHost === PORTAL_HOST && redirectPathname === "/sso/login") {
      result.diagnosis = portalDiagnosis;
      result.oauthLoopDetected = true;
      console.log("[portal-launch] diagnosis=" + portalDiagnosis);
    } else if (redirectHost === "xg.tyust.edu.cn" &&
      ["/cas/onelogin.aspx", "/cas/login/index", "/userhall/login/thirdpartycas"].some(item => redirectPathname.toLowerCase().includes(item.toLowerCase()))) {
      result.diagnosis = "xg-oauth-started";
      console.log("[portal-launch] diagnosis=xg-oauth-started");
    }
  } catch (err) {}
  return result;
}

function logLaunchHop(index, response, currentUrl) {
  const location = response && response.headers ? response.headers.location : "";
  console.log("[portal-launch] hop=" + index +
    " status=" + (response ? response.status : "none") +
    " host=" + sanitizeUrlForLog(currentUrl) +
    " pathname=" + safePathname(currentUrl) +
    " contentType=" + (contentTypeOf(response) || "none") +
    " hasLocation=" + Boolean(location) +
    " setCookieCount=" + setCookieCount(response));
}

function logLaunchUrlType(url) {
  const parts = safeHostPath(url);
  if (isIntermediateAuthUrl(url)) {
    console.log("[portal-launch] step=intermediate-auth detected=true host=" + parts.host + " pathname=" + parts.pathname);
  }
  if (isXgAuthUrl(url)) {
    console.log("[portal-launch] step=reached-xg-auth host=" + parts.host + " pathname=" + parts.pathname);
  }
  if (isXgHomeUrl(url)) {
    console.log("[portal-launch] step=reached-xg-home");
  }
}

function nextHtmlHop(response, currentUrl) {
  const html = responseText(response);
  const urls = extractAnyHtmlRedirectUrls(html, currentUrl).filter(url => {
    const path = safePathname(url).toLowerCase();
    if (/\.(ico|png|jpg|jpeg|gif|svg|css|js|map|woff|woff2|ttf|eot)$/i.test(path)) return false;
    if (path.includes("/service/uploadserver/") || path.includes("imageshow")) return false;
    return true;
  });
  return urls.find(url => isXgAuthUrl(url) || isXgHomeUrl(url) || isIntermediateAuthUrl(url)) ||
    urls.find(url => hostOf(url) === "xg.tyust.edu.cn") ||
    urls.find(url => hostOf(url) === "sso1.tyust.edu.cn") ||
    urls.find(url => hostOf(url) === PORTAL_HOST) ||
    "";
}

function jsonKeysOf(data) {
  const json = parseJsonMaybe(data);
  if (!json || typeof json !== "object") return [];
  return Object.keys(json).slice(0, 40);
}

function extractChoosePersonUrls(html, baseUrl) {
  const urls = [];
  extractAnyHtmlRedirectUrls(html, baseUrl).forEach(url => {
    if (isChoosePersonUrl(url)) urls.push(url);
  });
  encodedTextVariants(html).forEach(text => {
    const normalized = String(text || "")
      .replace(/\\\//g, "/")
      .replace(/\\u0026/ig, "&")
      .replace(/&amp;/g, "&");
    extractUrlsFromString(text, baseUrl).forEach(url => {
      if (isChoosePersonUrl(url)) urls.push(url);
    });
    extractUrlsFromString(normalized, baseUrl).forEach(url => {
      if (isChoosePersonUrl(url)) urls.push(url);
    });
    const pathPattern = /\/userhall\/login\/ChoosePerson[^"' <>)\\]*/ig;
    let match;
    while ((match = pathPattern.exec(normalized))) {
      const url = absoluteUrl(match[0].replace(/&amp;/g, "&"), baseUrl);
      if (url && isChoosePersonUrl(url)) urls.push(url);
    }
  });
  return Array.from(new Set(urls));
}

function extractChoosePersonForm(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  let found = null;
  $("form[action]").each((_, el) => {
    if (found) return;
    const action = absoluteUrl($(el).attr("action") || "", baseUrl);
    if (!isChoosePersonUrl(action)) return;
    const payload = {};
    $(el).find("input[name]").each((__, input) => {
      const name = String($(input).attr("name") || "").trim();
      if (!name) return;
      payload[name] = $(input).attr("value") || "";
    });
    found = {
      action,
      method: String($(el).attr("method") || "GET").toUpperCase(),
      payload
    };
  });
  return found;
}

function extractThirdpartyCasState(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const valueById = id => $("#" + id).attr("value") || $("#" + id).val() || "";
  const sign = valueById("sign");
  const status = valueById("status");
  const turl = valueById("turl");
  const msg = valueById("msg");
  const accesstype = valueById("accesstype");
  const chooseBase = valueById("person-choose-url");
  const stopProxyUrl = valueById("stopproxy-url");
  let chooseUrl = "";
  if (chooseBase && sign) {
    const parsed = new URL(absoluteUrl(chooseBase, baseUrl));
    parsed.searchParams.set("ty", "cas");
    parsed.searchParams.set("f", "1");
    parsed.searchParams.set("tk", sign);
    chooseUrl = parsed.toString();
  }
  console.log("[xg-session] step=thirdpartycas-state" +
    " status=" + (status || "none") +
    " accessType=" + (accesstype || "none") +
    " hasSign=" + Boolean(sign) +
    " hasTurl=" + Boolean(turl) +
    " hasMsg=" + Boolean(msg) +
    " hasChooseUrl=" + Boolean(chooseBase) +
    " hasStopProxyUrl=" + Boolean(stopProxyUrl));
  return { sign, status, turl, msg, accesstype, chooseBase, chooseUrl };
}

function logThirdpartycasHints(html, baseUrl) {
  const text = String(html || "");
  const $ = cheerio.load(text);
  const inputNames = [];
  $("input[name]").each((_, el) => {
    const name = String($(el).attr("name") || "").trim();
    if (name && !/^(tk|ticket|token|code)$/i.test(name)) inputNames.push(name);
  });
  console.log("[xg-session] step=thirdpartycas-hints" +
    " bodyLength=" + text.length +
    " formCount=" + $("form").length +
    " scriptCount=" + $("script").length +
    " inputKeys=" + (Array.from(new Set(inputNames)).slice(0, 20).join(",") || "none") +
    " containsChoosePerson=" + /chooseperson/i.test(text) +
    " containsChoosePersonQuery=" + /chooseperson\?/i.test(text) +
    " containsTkKey=" + /\btk\b/i.test(text) +
    " hasWindowLocation=" + /window\.location|location\.href|location\.replace/i.test(text) +
    " hasWindowOpen=" + /window\.open/i.test(text) +
    " hasMetaRefresh=" + /http-equiv=["']?refresh/i.test(text));
}

function safeQueryKeys(url) {
  try {
    return Array.from(new Set(Array.from(new URL(String(url || "")).searchParams.keys())))
      .filter(key => !/^(tk|ticket|token|code)$/i.test(key));
  } catch (err) {
    return [];
  }
}

function extractScriptUrls(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("script[src]").each((_, el) => {
    const url = absoluteUrl($(el).attr("src") || "", baseUrl);
    if (url && hostOf(url) === "xg.tyust.edu.cn") urls.push(url);
  });
  return Array.from(new Set(urls));
}

async function fetchXgScriptTexts(cookieJar, scriptUrls, referer) {
  const texts = [];
  for (const url of scriptUrls.slice(0, 12)) {
    const page = await requestNoRedirect(cookieJar, "GET", url, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "application/javascript,text/javascript,*/*",
        "Referer": referer || XG_ORIGIN + "/userhall/login/ChoosePerson"
      },
      timeout: 20000
    }).catch(err => {
      console.log("[xg-session] step=fetch-choose-js-failed code=" + safeMessage(err));
      return null;
    });
    if (!page) continue;
    console.log("[xg-session] step=fetch-choose-js status=" + page.status +
      " host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url));
    texts.push(responseText(page));
  }
  return texts;
}

function endpointContext(text, endpoint) {
  const raw = String(text || "");
  const index = raw.toLowerCase().indexOf(endpoint.toLowerCase());
  if (index < 0) return "";
  return raw.slice(Math.max(0, index - 1800), Math.min(raw.length, index + 1800));
}

function analyzePersonChooseRequest(texts) {
  const endpoint = "/userhall/api/login/person/choose";
  const joined = texts.join("\n");
  const context = endpointContext(joined, endpoint);
  const lower = context.toLowerCase();
  let method = "UNKNOWN";
  if (/method\s*:\s*["']post["']|\.post\s*\(|post\s*\(/i.test(context)) method = "POST";
  else if (/method\s*:\s*["']get["']|\.get\s*\(|get\s*\(/i.test(context)) method = "GET";
  const contentType = lower.includes("application/json") || /content-type[^,;]+json/i.test(context)
    ? "application/json"
    : (method === "POST" ? "unknown" : "none");
  const payloadKeys = new Set();
  const dataMatch = context.match(/data\s*:\s*\{([^}]{0,1200})\}/i) || context.match(/params\s*:\s*\{([^}]{0,1200})\}/i);
  if (dataMatch) extractParamKeysFromObjectSnippet(dataMatch[1]).forEach(key => payloadKeys.add(key));
  ["personId", "roleId", "userId", "id", "type", "roleType", "identityId", "personType", "tk"].forEach(key => {
    if (new RegExp("\\b" + key + "\\b", "i").test(context)) payloadKeys.add(key);
  });
  return {
    found: Boolean(context),
    endpoint,
    method: method === "UNKNOWN" ? "POST" : method,
    contentType,
    payloadKeys: Array.from(payloadKeys)
  };
}

function collectPersonCandidatesFromJson(value, candidates) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => collectPersonCandidatesFromJson(item, candidates));
    return;
  }
  const keys = Object.keys(value);
  const keyText = keys.join(",").toLowerCase();
  const valueText = keys.map(key => typeof value[key] === "string" ? value[key] : "").join(" ").toLowerCase();
  const looksPerson = /(person|role|student|user|identity|ry|js|xs|student)/i.test(keyText + " " + valueText) &&
    keys.some(key => /id$/i.test(key) || /person|role|user|identity/i.test(key));
  if (looksPerson) candidates.push(value);
  keys.forEach(key => collectPersonCandidatesFromJson(value[key], candidates));
}

function collectPersonCandidatesFromText(text) {
  const candidates = [];
  const raw = String(text || "");
  const jsonObjects = [];
  encodedTextVariants(raw).forEach(value => {
    const arrayPattern = /\[[^\[\]]{0,5000}(?:person|role|student|identity|user|学生|角色)[^\[\]]{0,5000}\]/ig;
    let match;
    while ((match = arrayPattern.exec(value))) jsonObjects.push(match[0]);
    const objectPattern = /\{[^{}]{0,2000}(?:person|role|student|identity|user|学生|角色)[^{}]{0,2000}\}/ig;
    while ((match = objectPattern.exec(value))) jsonObjects.push(match[0]);
  });
  jsonObjects.slice(0, 80).forEach(snippet => {
    const json = parseJsonMaybe(snippet);
    if (json) collectPersonCandidatesFromJson(json, candidates);
  });
  const seen = new Set();
  return candidates.filter(item => {
    const keys = Object.keys(item || {}).sort().join(",");
    if (seen.has(keys)) return false;
    seen.add(keys);
    return true;
  });
}

function collectPersonCandidatesFromChooseDom(html) {
  const $ = cheerio.load(String(html || ""));
  const chooseUrl = $("#Choose").attr("value") || $("#Choose").val() || "";
  const authKeyUrl = $("#auth-key-url").attr("value") || $("#auth-key-url").val() || "";
  const ty = $("#TY").attr("value") || $("#TY").val() || "";
  const captchaToken = $("#cu-tk").attr("value") || $("#cu-tk").val() || "";
  const username = $("#username").attr("value") || $("#username").val() || "";
  const candidates = [];
  const collect = (_, el) => {
    const node = $(el);
    const code = node.attr("code") || "";
    const account = node.attr("account") || username || "";
    const token = node.attr("token") || "";
    if (!code && !account && !token) return;
    candidates.push({
      account: encodeURIComponent(account),
      lv: code,
      token,
      type: (ty || "") + "-1",
      chooseUrl,
      authKeyUrl,
      captchaToken
    });
  };
  $(".choose-person .pserson").each(collect);
  if (!candidates.length) $(".choose-levels .icon").each(collect);
  console.log("[xg-session] step=choose-person-dom" +
    " psersonCount=" + $(".choose-person .pserson").length +
    " iconCount=" + $(".choose-levels .icon").length +
    " hasChooseUrl=" + Boolean(chooseUrl) +
    " hasAuthKeyUrl=" + Boolean(authKeyUrl) +
    " hasTY=" + Boolean(ty) +
    " hasCaptchaToken=" + Boolean(captchaToken) +
    " hasUsername=" + Boolean(username));
  return candidates;
}

function xgRandomNumber(chars) {
  const source = chars || "0123456789";
  return source.charAt(Math.floor(Math.random() * source.length));
}

function xgRandomStr(len) {
  const ln = len || xgRandomNum(1, 4);
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < ln; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function xgRandomString(len) {
  const ln = len || xgRandomNum(8, 30);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let tempStr = "";
  let n = 0;
  let cc = "";
  while (n !== ln) {
    if (n % 5 === 0 && n !== 0) {
      tempStr += xgRandomNumber();
      n += 1;
      continue;
    }
    const c = chars.charAt(Math.floor(Math.random() * chars.length));
    if (n % 4 < 3) {
      if (n === 0) {
        cc = c;
        tempStr += c;
        n += 1;
        continue;
      }
      const i1 = c.charCodeAt(0);
      const i2 = cc.charCodeAt(0);
      if ((n % 2 === 0 && Math.abs(i1 - i2) <= 6) ||
        (n % 2 === 1 && Math.abs(i1 - i2) <= 5)) {
        cc = c;
        tempStr += c;
        n += 1;
        continue;
      }
    } else {
      tempStr += c;
      cc = c;
      tempStr += c;
      n += 1;
    }
  }
  return tempStr;
}

function xgRandomNum(min, max, len) {
  const from = min || 0;
  const to = max || 20;
  const fixed = len || 0;
  return Number((from + (to - from) * Math.random()).toFixed(fixed));
}

function xgAuthParms() {
  const count = parseInt(xgRandomNumber("123"), 10);
  const pairs = [];
  for (let i = 1; i <= count; i++) {
    pairs.push(xgRandomStr() + "=" + xgRandomString(xgRandomNum(1, 12)));
  }
  return pairs.join("&");
}

function xgToCode(str) {
  const key = "0AB1CD89EFGH2IJKL3MNOP4QRSTUV7WXY65Z";
  const chars = key.split("");
  let out = "";
  for (let i = 0; i < String(str || "").length; i++) {
    let value = String(str || "").charCodeAt(i);
    const b1 = value % 36;
    value = (value - b1) / 36;
    const b2 = value % 36;
    value = (value - b2) / 36;
    const b3 = value % 36;
    out += chars[b3] + chars[b2] + chars[b1];
  }
  return out;
}

function xgFromCode(str) {
  const key = "0AB1CD89EFGH2IJKL3MNOP4QRSTUV7WXY65Z";
  const text = String(str || "").trim().replace(/^["']|["']$/g, "");
  const codes = [];
  for (let i = 0; i + 2 < text.length; i += 3) {
    const b1 = key.indexOf(text.charAt(i));
    const b2 = key.indexOf(text.charAt(i + 1));
    const b3 = key.indexOf(text.charAt(i + 2));
    if (b1 < 0 || b2 < 0 || b3 < 0) continue;
    codes.push(b1 * 36 * 36 + b2 * 36 + b3);
  }
  return String.fromCharCode.apply(String, codes);
}

function deriveXgContentAuthToken(encoded) {
  const stamp = xgFromCode(encoded);
  const num = parseInt(stamp.substring(0, 1), 10);
  const key = stamp.replace(/-/g, "").substring(num, stamp.replace(/-/g, "").length);
  let value = "";
  for (let i = 0; i < key.length; i++) {
    if (num % 2 === 0) {
      if (i % 2 === 0) value += key.split("")[i];
    } else if (i % 2 === 1) {
      value += key.split("")[i];
    }
  }
  return value;
}

function uAjaxPayloadText(payload) {
  return Object.keys(payload || {})
    .map(key => key + "=" + payload[key])
    .join("&");
}

function uAjaxAuthSign(payload) {
  const text = encodeURIComponent(
    uAjaxPayloadText(payload)
      .replace(/\"/g, "")
      .replace(/[\\]/g, "")
      .replace(/\s/g, "")
  ).toUpperCase();
  return crypto.createHash("md5").update(text).digest("hex");
}

function safeExceptionHint(value) {
  const text = JSON.stringify(value || {}).toLowerCase();
  if (text.includes("base-64") || text.includes("base64")) return "base64";
  if (text.includes("nullreference") || text.includes("object reference")) return "null-reference";
  if (text.includes("index") && text.includes("range")) return "index-range";
  if (text.includes("length")) return "length";
  if (text.includes("format")) return "format";
  if (text.includes("unauthorized") || text.includes("forbidden")) return "auth";
  return value ? "unknown" : "none";
}

async function prepareXgUAjaxHeaders(cookieJar, selected, requestUrl, payload, referer, settingUrlForCode) {
  if (!selected || !selected.authKeyUrl) {
    console.log("[xg-session] step=uajax-auth-skip reason=missing-auth-key-url");
    return {};
  }
  const authBase = absoluteUrl(selected.authKeyUrl, referer || XG_ORIGIN + "/userhall/login/ChoosePerson");
  if (!authBase) {
    console.log("[xg-session] step=uajax-auth-skip reason=invalid-auth-key-url");
    return {};
  }
  const codeCandidates = [
    { source: "raw", value: settingUrlForCode || "" },
    { source: "absolute", value: requestUrl || "" }
  ].filter(item => item.value);
  const seenCodeValues = new Set();
  for (const candidate of codeCandidates) {
    if (seenCodeValues.has(candidate.value)) continue;
    seenCodeValues.add(candidate.value);
    const authUrl = authBase.replace(/\/$/, "") + "/" + xgRandomString(xgRandomNum(8, 19)) + "?" + xgAuthParms();
    const time = Date.now();
    const captchaCode = xgToCode(time + "-" + candidate.value);
    console.log("[xg-session] step=uajax-auth-request" +
      " host=" + sanitizeUrlForLog(authUrl) +
      " pathname=" + safePathname(authUrl) +
      " codeSource=" + candidate.source +
      " hasCaptchaToken=" + Boolean(selected.captchaToken));
    const authResponse = await requestNoRedirect(cookieJar, "POST", authUrl, {
      data: "",
      headers: {
        "User-Agent": userAgent(),
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": XG_ORIGIN,
        "Referer": referer || XG_ORIGIN + "/userhall/login/ChoosePerson",
        "X-Requested-With": "XMLHttpRequest",
        "Captcha-Token": selected.captchaToken || "",
        "Captcha-Code": captchaCode
      },
      timeout: 20000
    }).catch(err => {
      console.log("[xg-session] step=uajax-auth-failed code=" + safeMessage(err));
      return null;
    });
    if (!authResponse || authResponse.status >= 400) {
    const authJson = authResponse ? parseJsonMaybe(authResponse.data) : null;
    console.log("[xg-session] step=uajax-auth-result status=" + (authResponse ? authResponse.status : "none") +
      " contentType=" + (authResponse ? (contentTypeOf(authResponse) || "none") : "none") +
      " bodyLength=" + (authResponse ? responseText(authResponse).length : 0) +
      " isJson=" + Boolean(authJson) +
      " jsonKeys=" + (authJson && typeof authJson === "object" ? Object.keys(authJson).slice(0, 20).join(",") : "none") +
      " exceptionType=" + (authJson && authJson.ExceptionType ? String(authJson.ExceptionType).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) : "none") +
      " exceptionHint=" + safeExceptionHint(authJson) +
      " resStatus=" + (authJson && authJson.ResStatus !== undefined ? authJson.ResStatus : "none") +
      " appStatus=" + (authJson && authJson.Status !== undefined ? authJson.Status : "none") +
      " hasAuthToken=false");
      continue;
    }
    const authToken = deriveXgContentAuthToken(responseText(authResponse));
    console.log("[xg-session] step=uajax-auth-result" +
      " status=" + authResponse.status +
      " contentType=" + (contentTypeOf(authResponse) || "none") +
      " setCookieCount=" + setCookieCount(authResponse) +
      " codeSource=" + candidate.source +
      " hasAuthToken=" + Boolean(authToken));
    if (!authToken) continue;
    return {
      "Content-AuthToken": authToken,
      "Content-AuthSign": uAjaxAuthSign(payload)
    };
  }
  return {};
}

function selectPersonCandidate(candidates) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.find(item => {
    const text = Object.keys(item || {}).map(key => String(item[key] || "")).join(" ").toLowerCase();
    return text.includes("student") || text.includes("学生") || text.includes("xs");
  }) || candidates[0];
}

function buildPersonChoosePayload(candidate, payloadKeys) {
  if (candidate && candidate.chooseUrl) {
    return {
      account: candidate.account || "",
      lv: candidate.lv || "",
      token: candidate.token || "",
      type: candidate.type || ""
    };
  }
  const payload = {};
  const source = candidate || {};
  const keys = payloadKeys && payloadKeys.length ? payloadKeys : Object.keys(source);
  keys.forEach(key => {
    if (/^(tk|token|ticket)$/i.test(key)) return;
    if (source[key] !== undefined && source[key] !== null && typeof source[key] !== "object") {
      payload[key] = source[key];
    }
  });
  if (!Object.keys(payload).length) {
    Object.keys(source).forEach(key => {
      if (/^(tk|token|ticket)$/i.test(key)) return;
      if ((/id$/i.test(key) || /person|role|user|identity/i.test(key)) &&
        source[key] !== undefined && source[key] !== null && typeof source[key] !== "object") {
        payload[key] = source[key];
      }
    });
  }
  return payload;
}

function extractXgLoginApiCandidates(texts, baseUrl) {
  const urls = [];
  texts.forEach(text => {
    const raw = String(text || "").replace(/\\\//g, "/");
    const pattern = /\/userhall\/api\/login\/[A-Za-z0-9_./-]*/ig;
    let match;
    while ((match = pattern.exec(raw))) {
      const url = absoluteUrl(match[0], baseUrl);
      if (url) urls.push(url);
    }
  });
  return Array.from(new Set(urls));
}

function hasStudentJudgeKeyword(text) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  return lower.includes("app_studentjudge") ||
    lower.includes("studentjudge") ||
    lower.includes("stustudentscore") ||
    lower.includes("application.aspx") ||
    value.includes("综合测评") ||
    value.includes("基础成绩") ||
    value.includes("学习成绩") ||
    value.includes("缁煎悎娴嬭瘎");
}

function collectXgJsUrls(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const urls = [];
  $("script[src]").each((_, el) => {
    const url = absoluteUrl($(el).attr("src") || "", baseUrl);
    if (url && hostOf(url) === "xg.tyust.edu.cn" && isLikelyJs(url)) urls.push(url);
  });
  extractQuotedStrings(html).forEach(value => {
    if (!/\.js(?:\?|$)/i.test(value)) return;
    const url = absoluteUrl(value.replace(/^\.\//, "/"), baseUrl);
    if (url && hostOf(url) === "xg.tyust.edu.cn" && isLikelyJs(url)) urls.push(url);
  });
  return Array.from(new Set(urls));
}

async function fetchXgJsAssets(cookieJar, jsUrls, referer) {
  const texts = [];
  for (const url of jsUrls.slice(0, 30)) {
    console.log("[xg-session] step=fetch-xg-js host=" + sanitizeUrlForLog(url) + " pathname=" + safePathname(url));
    const response = await requestNoRedirect(cookieJar, "GET", url, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "application/javascript,text/javascript,*/*",
        "Referer": referer || XG_ORIGIN + "/userhall/Sec/Page/Index"
      },
      timeout: 20000
    }).catch(err => {
      console.log("[xg-session] step=fetch-xg-js-failed code=" + safeMessage(err));
      return null;
    });
    if (!response) continue;
    const text = responseText(response);
    console.log("[xg-session] step=fetch-xg-js-result status=" + response.status +
      " host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url) +
      " containsStudentJudge=" + hasStudentJudgeKeyword(text));
    if (response.status >= 200 && response.status < 400) texts.push(text);
  }
  return texts;
}

function isXgApiPath(value) {
  const text = String(value || "").trim();
  if (!isNormalUrlRef(text)) return false;
  if (text.startsWith("http://") || text.startsWith("https://")) {
    return hostOf(text) === "xg.tyust.edu.cn" && safePathname(text).startsWith("/userhall/api/");
  }
  return /^\/userhall\/api\/[A-Za-z0-9_./-]+(?:[?#].*)?$/i.test(text) ||
    /^\/api\/[A-Za-z0-9_./-]+(?:[?#].*)?$/i.test(text);
}

function xgApiCandidateScore(url) {
  const lower = safePathname(url).toLowerCase();
  if (/\/(del|delete|save|update|remove|choose|login|auth|exit|logout|change|modified|proxy|clean)\b/i.test(lower)) {
    return -100;
  }
  let score = 0;
  ["home", "service", "app", "application", "menu", "student", "judge", "score", "work", "list", "type"].forEach(key => {
    if (lower.includes(key)) score += 2;
  });
  return score;
}

function extractXgApiCandidates(texts, baseUrl) {
  const candidates = [
    XG_ORIGIN + "/userhall/api/home/service/type"
  ];
  texts.forEach(text => {
    extractQuotedStrings(String(text || "").replace(/\\\//g, "/")).forEach(value => {
      if (!isXgApiPath(value)) return;
      const url = absoluteUrl(value.startsWith("/api/") ? "/userhall" + value : value, baseUrl);
      if (url && hostOf(url) === "xg.tyust.edu.cn") candidates.push(url);
    });
    const pattern = /\/(?:userhall\/)?api\/[A-Za-z0-9_./-]+/ig;
    let match;
    while ((match = pattern.exec(String(text || "").replace(/\\\//g, "/")))) {
      const raw = match[0].startsWith("/userhall/") ? match[0] : "/userhall" + match[0];
      const url = absoluteUrl(raw, baseUrl);
      if (url && hostOf(url) === "xg.tyust.edu.cn") candidates.push(url);
    }
  });
  return Array.from(new Set(candidates))
    .filter(url => xgApiCandidateScore(url) > -10)
    .sort((a, b) => xgApiCandidateScore(b) - xgApiCandidateScore(a));
}

function analyzeXgApiCall(texts, endpoint) {
  const joined = texts.join("\n");
  const context = endpointContext(joined, endpoint);
  if (!context) {
    console.log("[xg-session] step=analyze-xg-api-call pathname=" + endpoint + " found=false");
    return { found: false, method: "UNKNOWN", payloadKeys: [] };
  }
  logEndpointContext(endpoint, context);
  let method = "UNKNOWN";
  if (/type\s*:\s*["']post["']|method\s*:\s*["']post["']|\.post\s*\(|uajax\s*\(\s*\{[\s\S]{0,800}type\s*:\s*["']post["']/i.test(context)) method = "POST";
  else if (/type\s*:\s*["']get["']|method\s*:\s*["']get["']|\.get\s*\(/i.test(context)) method = "GET";
  const keys = new Set();
  const snippets = [];
  const dataMatch = context.match(/data\s*:\s*\{([^}]{0,1600})\}/i);
  if (dataMatch) snippets.push(dataMatch[1]);
  const paramsMatch = context.match(/params\s*:\s*\{([^}]{0,1600})\}/i);
  if (paramsMatch) snippets.push(paramsMatch[1]);
  snippets.forEach(snippet => extractParamKeysFromObjectSnippet(snippet).forEach(key => keys.add(key)));
  ["typeId", "TypeId", "id", "Id", "type", "Type", "level", "Level", "tag", "Tags", "scope", "Scope"].forEach(key => {
    if (new RegExp("\\b" + key + "\\b").test(context)) keys.add(key);
  });
  const payloadKeys = Array.from(keys);
  console.log("[xg-session] step=analyze-xg-api-call pathname=" + endpoint +
    " found=true method=" + method +
    " payloadKeys=" + (payloadKeys.join(",") || "none"));
  return { found: true, method, payloadKeys };
}

async function requestXgApiCandidate(cookieJar, url, referer, override) {
  const pathname = safePathname(url).toLowerCase();
  if (xgApiCandidateScore(url) <= -100) {
    console.log("[xg-session] step=skip-xg-api reason=unsafe pathname=" + safePathname(url));
    return null;
  }
  const method = override && override.method ? override.method : (pathname.includes("/userhall/api/home/service/get/all") ? "POST" : "GET");
  let requestUrl = url;
  const payload = method === "POST" ? ((override && override.data) || {}) : undefined;
  if (method === "GET" && override && override.data) {
    const parsed = new URL(url);
    Object.keys(override.data).forEach(key => parsed.searchParams.set(key, override.data[key]));
    requestUrl = parsed.toString();
  }
  console.log("[xg-session] step=request-xg-api method=" + method + " host=" + sanitizeUrlForLog(requestUrl) + " pathname=" + safePathname(requestUrl));
  const headers = {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Referer": referer || XG_ORIGIN + "/userhall/Sec/Page/Index",
      "X-Requested-With": "XMLHttpRequest"
  };
  if (method === "POST") {
    headers["Content-Type"] = override && override.form
      ? "application/x-www-form-urlencoded"
      : "application/json;charset=UTF-8";
    if (override && override.uAjaxAuth && override.authContext) {
      const authHeaders = await prepareXgUAjaxHeaders(
        cookieJar,
        override.authContext,
        url,
        payload,
        referer || XG_ORIGIN + "/userhall/Sec/Page/Index",
        safePathname(url)
      );
      Object.assign(headers, authHeaders);
      console.log("[xg-session] step=xg-api-uajax-auth authHeaders=" + Boolean(headers["Content-AuthToken"] && headers["Content-AuthSign"]));
    }
  }
  const response = await requestNoRedirect(cookieJar, method, requestUrl, {
    headers,
    data: method === "POST"
      ? ((override && override.form) ? new URLSearchParams(payload).toString() : payload)
      : undefined,
    timeout: 20000
  }).catch(err => {
    console.log("[xg-session] step=request-xg-api-failed code=" + safeMessage(err));
    return null;
  });
  if (!response) return null;
  const text = responseText(response);
  console.log("[xg-session] step=request-xg-api-result status=" + response.status +
    " host=" + sanitizeUrlForLog(requestUrl) +
    " pathname=" + safePathname(requestUrl) +
    " isJson=" + Boolean(parseJsonMaybe(response.data)) +
    " resStatus=" + ((parseJsonMaybe(response.data) || {}).ResStatus !== undefined ? (parseJsonMaybe(response.data) || {}).ResStatus : "none") +
    " appStatus=" + ((parseJsonMaybe(response.data) || {}).Status !== undefined ? (parseJsonMaybe(response.data) || {}).Status : "none") +
    " exceptionType=" + ((parseJsonMaybe(response.data) || {}).ExceptionType ? String((parseJsonMaybe(response.data) || {}).ExceptionType).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) : "none") +
    " containsStudentJudge=" + hasStudentJudgeKeyword(text) +
    " loginTimeout=" + isLoginTimeoutHtml(text));
  if (response.status >= 200 && response.status < 400 &&
    (pathname.includes("/userhall/api/home/service/type") || pathname.includes("/userhall/api/home/service/get/all"))) {
    logJsonShape("[xg-session] step=xg-api-json-shape pathname=" + safePathname(url), response.data);
  }
  if (isLoginTimeoutHtml(text)) throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  return response;
}

function findStudentJudgeRecords(value, records) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => findStudentJudgeRecords(item, records));
    return;
  }
  const keys = Object.keys(value);
  const text = keys.map(key => typeof value[key] === "string" ? value[key] : "").join(" ");
  if (hasStudentJudgeKeyword(text) || hasStudentJudgeKeyword(keys.join(" "))) records.push(value);
  keys.forEach(key => findStudentJudgeRecords(value[key], records));
}

function collectRecordObjects(value, records) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => collectRecordObjects(item, records));
    return;
  }
  const keys = Object.keys(value);
  if (keys.length && keys.some(key => typeof value[key] !== "object")) records.push(value);
  keys.forEach(key => collectRecordObjects(value[key], records));
}

function logJsonShape(prefix, data) {
  const json = parseJsonMaybe(data);
  if (!json) {
    console.log(prefix + " isJson=false");
    return;
  }
  const keySet = new Set();
  collectObjectKeys(json, keySet);
  const records = [];
  collectRecordObjects(json, records);
  console.log(prefix +
    " isJson=true" +
    " topKeys=" + (Array.isArray(json) ? "array" : Object.keys(json).slice(0, 20).join(",")) +
    " fieldKeys=" + (Array.from(keySet).slice(0, 30).join(",") || "none") +
    " recordCount=" + records.length);
}

function logXgHiddenUrlRefs($, baseUrl) {
  let count = 0;
  $("input[id], input[name]").each((_, el) => {
    const id = String($(el).attr("id") || "");
    const name = String($(el).attr("name") || "");
    const raw = String($(el).attr("value") || "");
    if (!raw || !/(\/userhall\/api\/|\/apps\/|App_StudentJudge|StuStudentScore)/i.test(raw)) return;
    const url = absoluteUrl(raw, baseUrl);
    if (!url || hostOf(url) !== "xg.tyust.edu.cn") return;
    count += 1;
    console.log("[xg-session] step=xg-home-hidden-url" +
      " id=" + (id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "none") +
      " name=" + (name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "none") +
      " host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url));
  });
  console.log("[xg-session] step=xg-home-hidden-url-count count=" + count);
}

function extractServiceTypeParams(serviceTypeJson) {
  const records = [];
  collectRecordObjects(serviceTypeJson, records);
  const params = [];
  records.forEach(record => {
    ["type", "Type", "typeId", "TypeId", "id", "Id", "code", "Code", "value", "Value"].forEach(key => {
      if (record[key] === undefined || record[key] === null || typeof record[key] === "object") return;
      const value = String(record[key]).trim();
      if (!value || value.length > 80) return;
      params.push({ key, value });
    });
  });
  const seen = new Set();
  return params.filter(item => {
    const marker = item.key + "=" + item.value;
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  }).slice(0, 20);
}

function valueFromRecordByKey(record, key) {
  if (!record || !key) return undefined;
  const wanted = String(key).toLowerCase();
  const found = Object.keys(record).find(item => item.toLowerCase() === wanted);
  return found ? record[found] : undefined;
}

function logStudentJudgeRecordSummary(record, source) {
  if (!record || typeof record !== "object") return;
  const keys = Object.keys(record);
  const nestedKeys = [];
  ["App", "AppExt", "TypeList", "TagList", "LevelList"].forEach(key => {
    const value = valueFromRecordByKey(record, key);
    if (value && typeof value === "object") nestedKeys.push(key + ":" + Object.keys(value).slice(0, 20).join("|"));
  });
  console.log("[xg-session] step=studentjudge-record-summary" +
    " source=" + source +
    " fieldKeys=" + keys.slice(0, 40).join(",") +
    " nestedKeys=" + (nestedKeys.join(",") || "none"));
  keys.forEach(key => {
    if (!/(url|href|link|target|redirect|turn|app)/i.test(key)) return;
    const value = record[key];
    if (typeof value !== "string") return;
    const url = absoluteUrl(value, XG_ORIGIN + "/userhall/Sec/Page/Index");
    if (!url || hostOf(url) !== "xg.tyust.edu.cn") return;
    console.log("[xg-session] step=studentjudge-record-url" +
      " field=" + key.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) +
      " host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url));
  });
}

function buildPayloadFromRecord(record, payloadKeys) {
  const payload = {};
  (payloadKeys || []).forEach(key => {
    const value = valueFromRecordByKey(record, key);
    if (value === undefined || value === null || typeof value === "object") return;
    payload[key] = value;
  });
  if (!Object.keys(payload).length) {
    ["Id", "Url", "AppKey", "Token", "Code", "LevelNo"].forEach(key => {
      const value = valueFromRecordByKey(record, key);
      if (value === undefined || value === null || typeof value === "object") return;
      payload[key.charAt(0).toLowerCase() + key.slice(1)] = value;
    });
  }
  return payload;
}

function buildJumpPayloadCandidates(record, payloadKeys) {
  const candidates = [];
  const add = payload => {
    const clean = {};
    Object.keys(payload || {}).forEach(key => {
      const value = payload[key];
      if (value === undefined || value === null || typeof value === "object") return;
      clean[key] = value;
    });
    const marker = Object.keys(clean).sort().join(",");
    if (!marker || candidates.some(item => Object.keys(item).sort().join(",") === marker)) return;
    candidates.push(clean);
  };
  add(buildPayloadFromRecord(record, payloadKeys));
  add({ url: valueFromRecordByKey(record, "Url") });
  add({ appKey: valueFromRecordByKey(record, "AppKey"), token: valueFromRecordByKey(record, "Token") });
  add({
    id: valueFromRecordByKey(record, "Id"),
    type: valueFromRecordByKey(record, "TypeIds"),
    url: valueFromRecordByKey(record, "Url"),
    appKey: valueFromRecordByKey(record, "AppKey"),
    token: valueFromRecordByKey(record, "Token")
  });
  add({
    id: valueFromRecordByKey(record, "Id"),
    typeId: valueFromRecordByKey(record, "TypeIds"),
    appKey: valueFromRecordByKey(record, "AppKey")
  });
  add({
    code: valueFromRecordByKey(record, "Code"),
    levelNo: valueFromRecordByKey(record, "LevelNo"),
    token: valueFromRecordByKey(record, "Token")
  });
  try {
    const serialized = JSON.stringify(record);
    add({ app: serialized });
    add({ service: serialized });
    add({ model: serialized });
  } catch (err) {}
  return candidates.slice(0, 8);
}

function isStudentJudgeOmniselectorUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const pathname = parsed.pathname.toLowerCase();
    return parsed.hostname === "xg.tyust.edu.cn" &&
      pathname.includes("/apps/app_studentjudge/") &&
      pathname.includes("/omniselector.aspx") &&
      parsed.searchParams.has("p");
  } catch (err) {
    return false;
  }
}

function isStudentJudgeApplicationUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const pathname = parsed.pathname.toLowerCase();
    return parsed.hostname === "xg.tyust.edu.cn" &&
      pathname.includes("/apps/app_studentjudge/") &&
      pathname.endsWith("/application.aspx") &&
      /\/\(s\([^/]+\)\)\//i.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

function xgAppUrlFromJumpResponse(data, baseUrl) {
  const json = parseJsonMaybe(data);
  const candidates = [];
  if (typeof json === "string") {
    candidates.push(json);
  } else if (json && typeof json === "object") {
    collectStringValues(json, candidates);
  } else {
    collectStringValues(data, candidates);
  }
  for (const value of candidates) {
    const url = absoluteUrl(value, baseUrl);
    if (isStudentJudgeOmniselectorUrl(url)) return url;
  }
  return "";
}

async function openStudentJudgeOmniselector(cookieJar, jumpUrl, referer) {
  console.log("[xg-app] step=open-omniselector" +
    " host=" + sanitizeUrlForLog(jumpUrl) +
    " pathname=" + safePathname(jumpUrl));
  const trace = [];
  let currentUrl = jumpUrl;
  let currentMethod = "GET";
  let currentData = undefined;
  let previousUrl = referer || XG_ORIGIN + "/userhall/Sec/Page/Index";
  let omniselectorRequestCount = 0;
  let response = null;
  let finalUrl = jumpUrl;
  let repeatedPConsumed = false;
  let first500 = null;
  const visited = new Set();
  const submittedForms = new Set();

  for (let hop = 1; hop <= 8; hop++) {
    visited.add(currentUrl);
    if (currentUrl === jumpUrl) omniselectorRequestCount += 1;
    if (omniselectorRequestCount > 1) repeatedPConsumed = true;
    const cookieCountBefore = xgCookieCount(cookieJar);
    console.log("[xg-app] cookieCountBefore=" + cookieCountBefore);
    const headers = {
        "User-Agent": userAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": previousUrl
    };
    let requestUrl = currentUrl;
    if (currentMethod === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (currentData && Object.keys(currentData).length) {
      const parsed = new URL(currentUrl);
      Object.keys(currentData).forEach(key => parsed.searchParams.set(key, currentData[key]));
      requestUrl = parsed.toString();
    }
    response = await requestNoRedirect(cookieJar, currentMethod, requestUrl, {
      headers,
      data: currentMethod === "POST" ? new URLSearchParams(currentData || {}).toString() : undefined,
      timeout: 20000
    }).catch(err => {
      console.log("[xg-app] step=omniselector-hop-failed code=" + safeMessage(err));
      return null;
    });
    if (!response) {
      return {
        response: null,
        finalUrl: currentUrl,
        urls: trace.map(item => item.url),
        trace,
        omniselectorRequestCount,
        repeatedPConsumed,
        first500
      };
    }
    finalUrl = currentUrl;
    const location = response && response.headers ? response.headers.location : "";
    const hopInfo = {
      hop,
      status: response.status,
      url: currentUrl,
      host: sanitizeUrlForLog(currentUrl),
      pathname: safePathname(currentUrl),
      hasLocation: Boolean(location),
      setCookieCount: setCookieCount(response),
      cookieCountBefore,
      cookieCountAfter: xgCookieCount(cookieJar)
    };
    trace.push(hopInfo);
    console.log("[xg-app] hop=" + hop +
      " status=" + response.status +
      " host=" + hopInfo.host +
      " pathname=" + hopInfo.pathname +
      " hasLocation=" + Boolean(location) +
      " setCookieCount=" + hopInfo.setCookieCount);
    console.log("[xg-app] cookieCountAfter=" + hopInfo.cookieCountAfter);
    if (response.status >= 500 && !first500) first500 = hopInfo;
    if (isStudentJudgeApplicationUrl(currentUrl)) break;

    let nextUrl = "";
    if (response.status >= 300 && response.status < 400 && location) {
      nextUrl = absoluteUrl(location, currentUrl);
      currentMethod = "GET";
      currentData = undefined;
    } else if (response.status === 200) {
      nextUrl = nextStudentJudgeHtmlHop(response, currentUrl, visited);
      if (nextUrl) {
        currentMethod = "GET";
        currentData = undefined;
      } else {
        const formRequest = nextStudentJudgeFormRequest(response, currentUrl, visited);
        if (formRequest) {
          const formKey = formRequest.method + " " + formRequest.url;
          if (!submittedForms.has(formKey)) {
            submittedForms.add(formKey);
            nextUrl = formRequest.url;
            currentMethod = formRequest.method;
            currentData = formRequest.data;
            console.log("[xg-app] step=form-navigation method=" + currentMethod +
              " host=" + sanitizeUrlForLog(nextUrl) +
              " pathname=" + safePathname(nextUrl) +
              " fieldCount=" + formRequest.fieldCount);
          }
        }
      }
    }
    if (!nextUrl || hostOf(nextUrl) !== "xg.tyust.edu.cn") break;
    previousUrl = currentUrl;
    currentUrl = nextUrl;
  }

  console.log("[xg-app] omniselectorRequestCount=" + omniselectorRequestCount);
  return {
    response,
    finalUrl,
    urls: trace.map(item => item.url),
    trace,
    omniselectorRequestCount,
    repeatedPConsumed,
    first500
  };
}

function applicationErrorDiagnostic(response) {
  const html = responseText(response);
  const title = cheerio.load(html)("title").first().text().replace(/\s+/g, " ").trim().slice(0, 120) || "none";
  const lower = html.toLowerCase();
  return {
    status: response ? response.status : 0,
    contentType: contentTypeOf(response) || "none",
    bodyLength: html.length,
    title,
    containsLoginTimeout: isLoginTimeoutHtml(html) || html.includes("登录超时"),
    containsServerError: /server error/i.test(html),
    containsRuntimeError: /runtime error|application error|asp\.net/i.test(html),
    containsException: /exception/i.test(html),
    containsSessionError: /session/i.test(html)
  };
}

function logApplicationErrorDiagnostic(response) {
  const diagnostic = applicationErrorDiagnostic(response);
  console.log("[xg-app] step=application-error-diagnostic" +
    " status=" + diagnostic.status +
    " contentType=" + diagnostic.contentType +
    " title=" + diagnostic.title +
    " bodyLength=" + diagnostic.bodyLength +
    " containsLoginTimeout=" + diagnostic.containsLoginTimeout +
    " containsServerError=" + diagnostic.containsServerError +
    " containsRuntimeError=" + diagnostic.containsRuntimeError +
    " containsException=" + diagnostic.containsException +
    " containsSessionError=" + diagnostic.containsSessionError);
  return diagnostic;
}

function isStudentJudgeScoreUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const pathname = parsed.pathname.toLowerCase();
    return parsed.hostname === "xg.tyust.edu.cn" &&
      pathname.includes("/apps/app_studentjudge/") &&
      pathname.endsWith("/stustudentscore.aspx") &&
      /\/\(s\([^/]+\)\)\//i.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

function scoreEntryCandidate(url, source) {
  if (!url || hostOf(url) !== "xg.tyust.edu.cn") return null;
  const path = safePathname(url).toLowerCase();
  if (!path.includes("/apps/app_studentjudge/") || !path.includes("stustudentscore.aspx")) return null;
  return {
    url,
    source,
    score: (isStudentJudgeScoreUrl(url) ? 10 : 0) + (path.includes("/(s(") ? 5 : 0)
  };
}

function collectScoreEntryCandidatesFromText(text, baseUrl, source) {
  const candidates = [];
  const add = raw => {
    const url = absoluteUrl(String(raw || "").replace(/\\\//g, "/"), baseUrl);
    const candidate = scoreEntryCandidate(url, source);
    if (candidate) candidates.push(candidate);
  };
  xgUrlsFromText(text, baseUrl).forEach(add);
  extractQuotedStrings(String(text || "").replace(/\\\//g, "/")).forEach(value => {
    if (/StuStudentScore\.aspx/i.test(value)) add(value);
  });
  return candidates;
}

function collectStudentJudgeInternalRefs(html, baseUrl) {
  const $ = cheerio.load(String(html || ""));
  const refs = [];
  const add = (source, raw) => {
    const url = absoluteUrl(String(raw || "").replace(/\\\//g, "/"), baseUrl);
    if (!url || hostOf(url) !== "xg.tyust.edu.cn") return;
    const path = safePathname(url).toLowerCase();
    const allowedAppPath = path.includes("/apps/app_studentjudge/") ||
      path.includes("/apploadframe/");
    if (!allowedAppPath) return;
    if (/\.(ico|png|jpg|jpeg|gif|svg|css|map|woff|woff2|ttf|eot)$/i.test(path)) return;
    refs.push({ source, url });
  };
  $("a[href]").each((_, el) => add("html", $(el).attr("href")));
  $("iframe[src], frame[src]").each((_, el) => add("iframe", $(el).attr("src")));
  $("form[action]").each((_, el) => add("html", $(el).attr("action")));
  $("script[src]").each((_, el) => add("javascript", $(el).attr("src")));
  extractQuotedStrings(String(html || "").replace(/\\\//g, "/")).forEach(value => {
    if (/App_StudentJudge|StuStudentScore|Menu|menu|Tree|tree|Nav|nav|Left|left/i.test(value)) {
      add("javascript", value);
    }
  });
  const seen = new Set();
  return refs.filter(ref => {
    const key = ref.source + "|" + ref.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchStudentJudgeInternalText(cookieJar, ref, referer) {
  const accept = isLikelyJs(ref.url)
    ? "application/javascript,text/javascript,*/*"
    : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const response = await requestNoRedirect(cookieJar, "GET", ref.url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": accept,
      "Referer": referer
    },
    timeout: 20000
  }).catch(err => {
    console.log("[xg-score] step=fetch-score-ref-failed source=" + ref.source + " code=" + safeMessage(err));
    return null;
  });
  if (!response || response.status < 200 || response.status >= 400) return null;
  return {
    response,
    finalUrl: ref.url,
    source: ref.source,
    text: responseText(response)
  };
}

async function discoverScoreEntryFromApplication(cookieJar, applicationPage) {
  const appUrl = applicationPage && applicationPage.finalUrl;
  const appHtml = responseText(applicationPage && applicationPage.response);
  const candidates = [];
  const addCandidate = candidate => {
    if (!candidate) return;
    if (candidates.some(item => item.url === candidate.url)) return;
    candidates.push(candidate);
  };

  collectLinks(appHtml, appUrl, (url, text) => {
    const haystack = (url + " " + text).toLowerCase();
    return haystack.includes("stustudentscore.aspx") ||
      haystack.includes("学习成绩查看") ||
      haystack.includes("基础成绩查看") ||
      haystack.includes("瀛︿範鎴愮哗") ||
      haystack.includes("鍩虹鎴愮哗");
  }).forEach(url => addCandidate(scoreEntryCandidate(url, "html")));

  collectScoreEntryCandidatesFromText(appHtml, appUrl, "javascript").forEach(addCandidate);

  const $ = cheerio.load(appHtml);
  $("iframe[src], frame[src]").each((_, el) => {
    addCandidate(scoreEntryCandidate(absoluteUrl($(el).attr("src") || "", appUrl), "iframe"));
  });
  $("form[action]").each((_, el) => {
    addCandidate(scoreEntryCandidate(absoluteUrl($(el).attr("action") || "", appUrl), "html"));
  });

  const scriptUrls = collectXgJsUrls(appHtml, appUrl);
  for (const scriptUrl of scriptUrls.slice(0, 20)) {
    const response = await requestNoRedirect(cookieJar, "GET", scriptUrl, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "application/javascript,text/javascript,*/*",
        "Referer": appUrl
      },
      timeout: 20000
    }).catch(err => {
      console.log("[xg-score] step=fetch-score-script-failed code=" + safeMessage(err));
      return null;
    });
    if (!response || response.status < 200 || response.status >= 400) continue;
    collectScoreEntryCandidatesFromText(responseText(response), scriptUrl, "javascript").forEach(addCandidate);
  }

  const refs = collectStudentJudgeInternalRefs(appHtml, appUrl)
    .filter(ref => ref.url !== appUrl)
    .slice(0, 30);
  console.log("[xg-score] step=score-entry-sources" +
    " linkCount=" + $("a[href]").length +
    " iframeCount=" + $("iframe[src], frame[src]").length +
    " formCount=" + $("form[action]").length +
    " scriptCount=" + $("script[src]").length +
    " internalRefCount=" + refs.length);
  $("iframe[src], frame[src]").each((index, el) => {
    const url = absoluteUrl($(el).attr("src") || "", appUrl);
    console.log("[xg-score] step=score-entry-frame index=" + index +
      " host=" + (url ? sanitizeUrlForLog(url) : "none") +
      " pathname=" + (url ? safePathname(url) : "none"));
  });
  $("form[action]").each((index, el) => {
    const url = absoluteUrl($(el).attr("action") || "", appUrl);
    console.log("[xg-score] step=score-entry-form index=" + index +
      " method=" + String($(el).attr("method") || "GET").toUpperCase() +
      " host=" + (url ? sanitizeUrlForLog(url) : "none") +
      " pathname=" + (url ? safePathname(url) : "none"));
  });
  const queued = refs.slice();
  const visited = new Set([appUrl]);
  while (queued.length && candidates.length === 0 && visited.size < 40) {
    const ref = queued.shift();
    if (!ref || visited.has(ref.url)) continue;
    visited.add(ref.url);
    const fetched = await fetchStudentJudgeInternalText(cookieJar, ref, appUrl);
    if (!fetched) continue;
    const fetchedRefs = collectStudentJudgeInternalRefs(fetched.text, fetched.finalUrl);
    console.log("[xg-score] step=score-ref-result" +
      " source=" + ref.source +
      " status=" + fetched.response.status +
      " pathname=" + safePathname(fetched.finalUrl) +
      " containsScorePage=" + /StuStudentScore\.aspx/i.test(fetched.text) +
      " containsStudyScore=" + (fetched.text.includes("学习成绩查看") || fetched.text.includes("瀛︿範鎴愮哗")) +
      " containsBasicScore=" + (fetched.text.includes("基础成绩查看") || fetched.text.includes("鍩虹鎴愮哗")) +
      " internalRefCount=" + fetchedRefs.length);
    collectScoreEntryCandidatesFromText(fetched.text, fetched.finalUrl, ref.source === "javascript" ? "javascript" : "html").forEach(addCandidate);
    collectLinks(fetched.text, fetched.finalUrl, (url, text) => {
      const haystack = (url + " " + text).toLowerCase();
      return haystack.includes("stustudentscore.aspx") ||
        haystack.includes("学习成绩查看") ||
        haystack.includes("基础成绩查看") ||
        haystack.includes("瀛︿範鎴愮哗") ||
        haystack.includes("鍩虹鎴愮哗");
    }).forEach(url => addCandidate(scoreEntryCandidate(url, ref.source === "iframe" ? "iframe" : "html")));
    fetchedRefs
      .filter(next => !visited.has(next.url))
      .slice(0, 10)
      .forEach(next => queued.push(next));
  }

  const selected = candidates
    .sort((a, b) => b.score - a.score)[0] || null;
  console.log("[xg-score] step=discover-score-entry" +
    " found=" + Boolean(selected) +
    " source=" + (selected ? selected.source : "none") +
    " pathname=" + (selected ? safePathname(selected.url) : "none"));
  return selected;
}

function scorePageValidationFlags(html) {
  const text = String(html || "");
  return {
    containsGridView1: text.includes("GridView1"),
    containsYearTime: text.includes("YearTime"),
    containsViewState: text.includes("__VIEWSTATE"),
    containsEventValidation: text.includes("__EVENTVALIDATION"),
    containsScorePage: text.includes(SCORE_PAGE_NAME)
  };
}

function gridViewHeaders(html) {
  const $ = cheerio.load(String(html || ""));
  const headers = [];
  $("#GridView1 tr").first().find("th,td").each((_, cell) => {
    const text = safeText($(cell).text());
    if (text) headers.push(text);
  });
  return headers;
}

async function verifyAndQueryScoreEntry(cookieJar, applicationPage, debugState) {
  const entry = await discoverScoreEntryFromApplication(cookieJar, applicationPage);
  if (debugState) debugState.scoreEntryFound = Boolean(entry);
  if (!entry) return null;

  const verified = await verifyScoreUrl(cookieJar, entry.url, applicationPage.finalUrl);
  if (!verified) return null;

  const scorePage = await getPage(cookieJar, verified.scoreUrl, applicationPage.finalUrl).catch(err => {
    console.log("[xg-score] step=score-page-failed code=" + safeMessage(err));
    return null;
  });
  if (!scorePage || !scorePage.response) return null;
  const scoreHtml = responseText(scorePage.response);
  const flags = scorePageValidationFlags(scoreHtml);
  const valid = scorePage.response.status === 200 &&
    !isLoginTimeoutPage(scorePage) &&
    (flags.containsGridView1 ||
      (flags.containsYearTime && flags.containsViewState && flags.containsEventValidation && flags.containsScorePage));
  console.log("[xg-score] step=score-page-result" +
    " status=" + scorePage.response.status +
    " containsGridView1=" + flags.containsGridView1 +
    " containsYearTime=" + flags.containsYearTime +
    " containsViewState=" + flags.containsViewState);
  if (debugState) {
    debugState.scorePageReached = true;
    debugState.scorePageValid = Boolean(valid);
    debugState.containsGridView1 = Boolean(flags.containsGridView1);
    debugState.xgScoreHeaders = gridViewHeaders(scoreHtml);
  }
  if (!valid) return null;

  console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
    " pathname=" + safePathname(verified.scoreUrl) +
    " cookieLength=" + verified.cookies.length);
  const grades = await queryXgScores({
    scoreUrl: verified.scoreUrl,
    cookies: verified.cookies,
    term: "",
    courseName: "",
    courseType: ""
  });
  console.log("[xg-session] step=score-query-complete count=" + grades.length);
  if (debugState) {
    debugState.xgGradesParsed = true;
    debugState.xgGradeCount = grades.length;
    debugState.xgGrades = grades;
  }
  console.log("[xg-session] step=return-xg-success count=" + grades.length);
  return { scoreUrl: verified.scoreUrl, cookies: verified.cookies, grades };
}

function isScoreQueryResult(value) {
  return Boolean(value && value.scoreUrl && value.cookies && Array.isArray(value.grades));
}

function nextStudentJudgeHtmlHop(response, currentUrl, visited) {
  const html = responseText(response);
  const candidates = Array.from(new Set(
    extractAnyHtmlRedirectUrls(html, currentUrl)
      .concat(xgUrlsFromText(html, currentUrl))
      .concat(collectLinks(html, currentUrl, url => hostOf(url) === "xg.tyust.edu.cn"))
  )).filter(url => {
    if (hostOf(url) !== "xg.tyust.edu.cn") return false;
    if (visited && visited.has(url)) return false;
    const path = safePathname(url).toLowerCase();
    if (/\.(ico|png|jpg|jpeg|gif|svg|css|js|map|woff|woff2|ttf|eot)$/i.test(path)) return false;
    if (path.includes("/service/uploadserver/") || path.includes("imageshow")) return false;
    if (!path.includes("/apps/app_studentjudge/")) return false;
    return path.includes("/application.aspx") || path.includes("/omniselector.aspx");
  });
  return candidates.find(url => isStudentJudgeApplicationUrl(url)) ||
    candidates.find(url => safePathname(url).toLowerCase().includes("/application.aspx")) ||
    candidates.find(url => safePathname(url).toLowerCase().includes("/omniselector.aspx")) ||
    "";
}

function nextStudentJudgeFormRequest(response, currentUrl, visited) {
  const html = responseText(response);
  const $ = cheerio.load(html);
  let request = null;
  $("form").each((_, el) => {
    if (request) return;
    const rawAction = $(el).attr("action") || currentUrl;
    const url = absoluteUrl(rawAction, currentUrl);
    if (!url || hostOf(url) !== "xg.tyust.edu.cn") return;
    const path = safePathname(url).toLowerCase();
    if (!path.includes("/apps/app_studentjudge/")) return;
    if (!path.includes("/application.aspx") && !path.includes("/omniselector.aspx")) return;
    const method = String($(el).attr("method") || "GET").toUpperCase();
    if (visited && visited.has(url) && method !== "POST") return;
    const data = {};
    $(el).find("input[name]").each((__, input) => {
      const name = String($(input).attr("name") || "");
      if (!name) return;
      data[name] = $(input).attr("value") || "";
    });
    request = {
      url,
      method: method === "POST" ? "POST" : "GET",
      data,
      fieldCount: Object.keys(data).length
    };
  });
  return request;
}

async function collectJumpUrlsForStudentJudgeRecords(cookieJar, records, authContext, baseUrl, texts, debugState) {
  const jumpEndpoint = XG_ORIGIN + "/userhall/api/omni/get/jump/url";
  const urls = [];
  for (const record of records.slice(0, 6)) {
    const serviceId = valueFromRecordByKey(record, "Id");
    if (serviceId === undefined || serviceId === null || typeof serviceId === "object" || !String(serviceId).trim()) continue;
    const payload = { serviceid: serviceId };
    console.log("[xg-app] step=request-jump-url method=POST payloadKeys=serviceid");
    const response = await requestXgApiCandidate(cookieJar, jumpEndpoint, baseUrl, {
      method: "POST",
      data: payload,
      form: true,
      uAjaxAuth: true,
      authContext
    });
    if (!response || response.status < 200 || response.status >= 400) continue;

    const jumpUrl = xgAppUrlFromJumpResponse(response.data, jumpEndpoint);
    const jsonLikeResponse = contentTypeOf(response).includes("json") || Boolean(parseJsonMaybe(response.data)) || typeof response.data === "string";
    console.log("[xg-app] step=jump-url-result" +
      " status=" + response.status +
      " isJson=" + jsonLikeResponse +
      " urlFound=" + Boolean(jumpUrl) +
      " host=" + (jumpUrl ? sanitizeUrlForLog(jumpUrl) : "none") +
      " pathname=" + (jumpUrl ? safePathname(jumpUrl) : "none") +
      " hasSelectorParam=" + (jumpUrl ? new URL(jumpUrl).searchParams.has("p") : false));
    if (!jumpUrl) continue;
    if (debugState) debugState.jumpUrlSuccess = true;

    const page = await openStudentJudgeOmniselector(cookieJar, jumpUrl, baseUrl);
    if (!page || !page.response) continue;
    if (debugState) debugState.omniselectorReached = true;
    const finalPath = safePathname(page.finalUrl);
    const dynamicApplication = isStudentJudgeApplicationUrl(page.finalUrl);
    const appHtml = responseText(page.response);
    const applicationPageValid = dynamicApplication &&
      page.response.status >= 200 &&
      page.response.status < 500 &&
      !isLoginTimeoutPage(page) &&
      !isLoginTimeoutHtml(appHtml);
    if (debugState) {
      debugState.dynamicSessionPathReached = Boolean(dynamicApplication);
      debugState.studentJudgeSessionEstablished = Boolean(applicationPageValid);
      debugState.applicationPageValid = Boolean(applicationPageValid);
      debugState.omniselectorRequestCount = page.omniselectorRequestCount || 0;
      debugState.repeatedPConsumed = Boolean(page.repeatedPConsumed);
      debugState.first500Hop = page.first500 ? page.first500.hop : 0;
      debugState.first500Pathname = page.first500 ? page.first500.pathname : "";
      debugState.first500In = page.first500
        ? (String(page.first500.pathname).toLowerCase().includes("/application.aspx") ? "Application.aspx" : "Omniselector.aspx")
        : "none";
      debugState.cookieCounts = (page.trace || []).map(item => ({
        hop: item.hop,
        before: item.cookieCountBefore,
        after: item.cookieCountAfter
      }));
    }
    console.log("[xg-app] step=omniselector-result" +
      " status=" + page.response.status +
      " finalHost=" + sanitizeUrlForLog(page.finalUrl) +
      " finalApp=" + (String(finalPath).toLowerCase().includes("/apps/app_studentjudge/") ? "App_StudentJudge" : "none") +
      " finalPage=" + (String(finalPath).toLowerCase().endsWith("/application.aspx") ? "Application.aspx" : "none") +
      " hasDynamicSessionPath=" + dynamicApplication);
    if (debugState) console.log("[xg-app] dynamicSessionPathReached=" + Boolean(debugState.dynamicSessionPathReached));
    console.log("[xg-app] step=studentjudge-session-established ok=" + applicationPageValid);
    console.log("[xg-app] step=application-page-valid ok=" + applicationPageValid);
    if (page.response.status >= 500) {
      const diagnostic = logApplicationErrorDiagnostic(page.response);
      if (debugState) debugState.applicationErrorDiagnostic = diagnostic;
    }
    if (applicationPageValid) {
      const scoreQueryResult = await verifyAndQueryScoreEntry(cookieJar, page, debugState);
      if (isScoreQueryResult(scoreQueryResult)) return scoreQueryResult;
    }
    urls.push(page.finalUrl);
    return Array.from(new Set(urls));
  }
  return Array.from(new Set(urls));
}

async function collectDetailUrlsForStudentJudgeRecords(cookieJar, records, authContext, baseUrl, texts) {
  const detailEndpoint = XG_ORIGIN + "/userhall/api/home/service/detail";
  const analysis = analyzeXgApiCall(texts, "/userhall/api/home/service/detail");
  const urls = [];
  for (const record of records.slice(0, 6)) {
    const payloads = [
      buildPayloadFromRecord(record, analysis.payloadKeys.length ? analysis.payloadKeys : ["id"]),
      { id: valueFromRecordByKey(record, "Id") },
      { id: valueFromRecordByKey(record, "Id"), type: valueFromRecordByKey(record, "TypeIds") },
      { id: valueFromRecordByKey(record, "Id"), typeId: valueFromRecordByKey(record, "TypeIds") }
    ];
    for (const payload of payloads) {
      const clean = {};
      Object.keys(payload || {}).forEach(key => {
        const value = payload[key];
        if (value !== undefined && value !== null && typeof value !== "object") clean[key] = value;
      });
      const payloadKeys = Object.keys(clean);
      if (!payloadKeys.length) continue;
      for (const method of ["GET", "POST"]) {
        console.log("[xg-session] step=request-studentjudge-detail method=" + method + " payloadKeys=" + payloadKeys.join(","));
        const response = await requestXgApiCandidate(cookieJar, detailEndpoint, baseUrl, {
          method,
          data: clean,
          form: true,
          uAjaxAuth: method === "POST",
          authContext
        });
        if (!response || response.status < 200 || response.status >= 400) continue;
        const json = parseJsonMaybe(response.data);
        const found = json
          ? studentJudgeUrlsFromValue(json, detailEndpoint)
          : studentJudgeUrlsFromHtmlAndText([responseText(response)], detailEndpoint);
        console.log("[xg-session] step=studentjudge-detail-result found=" + Boolean(found.length) +
          " urlCount=" + found.length +
          " isJson=" + Boolean(json));
        found.forEach(url => urls.push(url));
        if (found.length) return Array.from(new Set(urls));
      }
    }
  }
  return Array.from(new Set(urls));
}

function studentJudgeUrlsFromValue(value, baseUrl) {
  const urls = [];
  const strings = [];
  collectStringValues(value, strings);
  strings.forEach(str => {
    encodedTextVariants(str).forEach(text => {
      extractUrlsFromString(text.replace(/\\\//g, "/"), baseUrl).forEach(url => {
        if (hostOf(url) === "xg.tyust.edu.cn" && hasStudentJudgeKeyword(url)) urls.push(url);
      });
      xgUrlsFromText(text, baseUrl).forEach(url => {
        if (hostOf(url) === "xg.tyust.edu.cn" && hasStudentJudgeKeyword(url)) urls.push(url);
      });
      if (hasStudentJudgeKeyword(text) && isNormalUrlRef(text)) {
        const url = absoluteUrl(text, baseUrl);
        if (url && hostOf(url) === "xg.tyust.edu.cn") urls.push(url);
      }
    });
  });
  return Array.from(new Set(urls));
}

function studentJudgeUrlsFromHtmlAndText(texts, baseUrl) {
  return Array.from(new Set(texts.flatMap(text => {
    const htmlUrls = appLinksFromHtml(text, baseUrl)
      .filter(url => hasStudentJudgeKeyword(url));
    const textUrls = xgUrlsFromText(text, baseUrl)
      .filter(url => hasStudentJudgeKeyword(url));
    return htmlUrls.concat(textUrls);
  })));
}

async function discoverStudentJudgeFromXgHome(cookieJar, homePage, debugState) {
  const baseUrl = homePage.finalUrl || XG_ORIGIN + "/userhall/Sec/Page/Index";
  const homeHtml = responseText(homePage.response);
  const homeDom = cheerio.load(homeHtml);
  const authContext = {
    authKeyUrl: homeDom("#auth-key-url").attr("value") || homeDom("#auth-key-url").val() || "",
    captchaToken: homeDom("#cu-tk").attr("value") || homeDom("#cu-tk").val() || ""
  };
  console.log("[xg-session] step=xg-home-auth-context hasAuthKeyUrl=" + Boolean(authContext.authKeyUrl) +
    " hasCaptchaToken=" + Boolean(authContext.captchaToken));
  logXgHiddenUrlRefs(homeDom, baseUrl);
  const jsUrls = collectXgJsUrls(homeHtml, baseUrl);
  console.log("[xg-session] step=xg-home-js-assets count=" + jsUrls.length);
  const jsTexts = await fetchXgJsAssets(cookieJar, jsUrls, baseUrl);
  const apiCandidates = extractXgApiCandidates([homeHtml].concat(jsTexts), baseUrl);
  const serviceAllAnalysis = analyzeXgApiCall([homeHtml].concat(jsTexts), "/userhall/api/home/service/get/all");
  console.log("[xg-session] step=xg-api-candidates count=" + apiCandidates.length);
  apiCandidates.slice(0, 30).forEach(url => {
    console.log("[xg-session] xgApi=" + safePathname(url));
  });

  const records = [];
  const launchUrls = studentJudgeUrlsFromHtmlAndText([homeHtml].concat(jsTexts), baseUrl);
  const serviceTypeParams = [];
  for (const apiUrl of apiCandidates.slice(0, 30)) {
    const response = await requestXgApiCandidate(cookieJar, apiUrl, baseUrl);
    if (!response || response.status < 200 || response.status >= 400) continue;
    const json = parseJsonMaybe(response.data);
    if (json) {
      if (safePathname(apiUrl).toLowerCase().includes("/userhall/api/home/service/type")) {
        extractServiceTypeParams(json).forEach(item => serviceTypeParams.push(item));
        console.log("[xg-session] step=service-type-params count=" + serviceTypeParams.length +
          " keys=" + (Array.from(new Set(serviceTypeParams.map(item => item.key))).join(",") || "none"));
      }
      const before = records.length;
      findStudentJudgeRecords(json, records);
      if (records.length > before) {
        console.log("[xg-session] step=find-studentjudge-record found=true fieldKeys=" +
          Object.keys(records[before] || {}).slice(0, 30).join(","));
        logStudentJudgeRecordSummary(records[before], safePathname(apiUrl));
      }
      studentJudgeUrlsFromValue(json, apiUrl).forEach(url => launchUrls.push(url));
    } else {
      studentJudgeUrlsFromHtmlAndText([responseText(response)], apiUrl).forEach(url => launchUrls.push(url));
    }
  }

  const serviceAllUrl = apiCandidates.find(url => safePathname(url).toLowerCase().includes("/userhall/api/home/service/get/all"));
  if (serviceAllUrl && serviceTypeParams.length) {
    for (const param of serviceTypeParams.slice(0, 12)) {
      const data = {};
      const targetKeys = serviceAllAnalysis.payloadKeys.length ? serviceAllAnalysis.payloadKeys : [param.key];
      targetKeys.forEach(key => {
        if (/^(name|mainshow|scope|tags|levels|num|icon)$/i.test(key)) return;
        data[key] = param.value;
      });
      if (!Object.keys(data).length) data[param.key] = param.value;
      console.log("[xg-session] step=request-service-all-by-type paramKey=" + param.key +
        " payloadKeys=" + Object.keys(data).join(","));
      const response = await requestXgApiCandidate(cookieJar, serviceAllUrl, baseUrl, {
        method: "POST",
        data,
        form: true,
        uAjaxAuth: true,
        authContext
      });
      if (!response || response.status < 200 || response.status >= 400) continue;
      const json = parseJsonMaybe(response.data);
      if (json) {
        const before = records.length;
        findStudentJudgeRecords(json, records);
        if (records.length > before) {
          console.log("[xg-session] step=find-studentjudge-record found=true source=service-all fieldKeys=" +
            Object.keys(records[before] || {}).slice(0, 30).join(","));
          logStudentJudgeRecordSummary(records[before], "service-all");
        }
        studentJudgeUrlsFromValue(json, serviceAllUrl).forEach(url => launchUrls.push(url));
        if (records.length > 0) break;
      } else {
        studentJudgeUrlsFromHtmlAndText([responseText(response)], serviceAllUrl).forEach(url => launchUrls.push(url));
      }
    }
  }

  records.forEach(record => {
    studentJudgeUrlsFromValue(record, baseUrl).forEach(url => launchUrls.push(url));
  });
  if (debugState) debugState.studentJudgeRecordFound = records.length > 0;
  console.log("[xg-app] step=find-studentjudge-record found=" + Boolean(records.length) +
    " recordCount=" + records.length);
  const jumpUrls = await collectJumpUrlsForStudentJudgeRecords(
    cookieJar,
    records,
    authContext,
    baseUrl,
    [homeHtml].concat(jsTexts),
    debugState
  );
  if (isScoreQueryResult(jumpUrls)) return jumpUrls;
  jumpUrls.forEach(url => launchUrls.push(url));
  const candidates = Array.from(new Set(launchUrls))
    .filter(url => hostOf(url) === "xg.tyust.edu.cn")
    .flatMap(url => {
      const urls = [url];
      const path = safePathname(url).toLowerCase();
      if (path.replace(/\/+$/, "").endsWith("/apps/app_studentjudge")) {
        urls.push(absoluteUrl("Application.aspx", url.endsWith("/") ? url : url + "/"));
      }
      return urls;
    })
    .sort((a, b) => {
      const ap = safePathname(a).toLowerCase();
      const bp = safePathname(b).toLowerCase();
      const score = path => (path.includes("application.aspx") ? 10 : 0) + (path.includes("app_studentjudge") ? 5 : 0);
      return score(bp) - score(ap);
    });
  console.log("[xg-session] step=find-studentjudge-app found=" + Boolean(candidates.length) +
    " recordCount=" + records.length +
    " urlCount=" + candidates.length);
  candidates.slice(0, 10).forEach(url => {
    console.log("[xg-session] studentJudgeUrl host=" + sanitizeUrlForLog(url) + " pathname=" + safePathname(url));
  });
  return candidates;
}

async function followLaunchRedirectChain(cookieJar, launch, initialMethod, initialPayload, referer, options) {
  if (!launch || !launch.response || !launch.requestUrl) {
    return {
      ssoLaunchStarted: false,
      xgAuthReached: false,
      xgSessionEstablished: false,
      thirdpartycasFound: false,
      failedHop: 0,
      finalUrl: "",
      authorizeRedirectHost: "unknown",
      authorizeRedirectPathname: "unknown",
      diagnosis: "",
      oauthLoopDetected: false,
      errorCode: "XG_LAUNCH_URL_NOT_FOUND"
    };
  }

  let response = launch.response;
  let currentUrl = launch.requestUrl;
  let method = String(initialMethod || "GET").toUpperCase();
  let data = method === "GET" ? undefined : (initialPayload || {});
  let previousUrl = referer || PORTAL_ORIGIN + "/index";
  let xgAuthReached = false;
  let thirdpartycasFound = false;
  let failedHop = 0;
  let portalOauthRetryDone = false;
  let authorizeInfo = {
    authorizeRedirectHost: "unknown",
    authorizeRedirectPathname: "unknown",
    diagnosis: "",
    oauthLoopDetected: false
  };
  const initialUrl = launch.requestUrl;
  const initialUpperMethod = String(initialMethod || "GET").toUpperCase();
  const initialData = initialUpperMethod === "GET" ? undefined : (initialPayload || {});

  for (let hop = 1; hop <= 10; hop++) {
    logLaunchHop(hop, response, currentUrl);
    logLaunchUrlType(currentUrl);
    if (isXgAuthUrl(currentUrl) || isXgHomeUrl(currentUrl) || hostOf(currentUrl) === "xg.tyust.edu.cn") {
      xgAuthReached = true;
      thirdpartycasFound = thirdpartycasFound || isThirdpartyCasUrl(currentUrl);
      console.log("[xg-session] step=xg-cookie-established cookieCount=" + xgCookieCount(cookieJar));
    }

    if (isLoginTimeoutUrl(currentUrl) || isLoginTimeoutHtml(responseText(response))) {
      failedHop = hop;
      return {
        ssoLaunchStarted: true,
        xgAuthReached,
        xgSessionEstablished: false,
        thirdpartycasFound,
        failedHop,
        finalUrl: currentUrl,
        errorCode: "XG_LOGIN_REQUIRED"
      };
    }

    const location = response && response.headers ? response.headers.location : "";
    let nextUrl = "";
    let nextMethod = method;
    let nextData = data;

    if (response && response.status >= 300 && response.status < 400) {
      if (!location) {
        failedHop = hop;
        break;
      }
      nextUrl = absoluteUrl(location, currentUrl);
      const inspected = inspectAuthorizeLocation(nextUrl, options);
      if (inspected.isAuthorize) {
        authorizeInfo = {
          authorizeRedirectHost: inspected.authorizeRedirectHost,
          authorizeRedirectPathname: inspected.authorizeRedirectPathname,
          diagnosis: inspected.diagnosis || authorizeInfo.diagnosis,
          oauthLoopDetected: inspected.oauthLoopDetected || authorizeInfo.oauthLoopDetected
        };
        if (inspected.diagnosis === "portal-oauth-loop" || inspected.diagnosis === "unexpected-portal-oauth") {
          console.log("[portal-launch] step=oauth-loop-detected repeats=2");
          return {
            ssoLaunchStarted: true,
            xgAuthReached,
            xgSessionEstablished: false,
            thirdpartycasFound,
            failedHop: hop,
            finalUrl: nextUrl,
            finalHost: sanitizeUrlForLog(nextUrl),
            finalPathname: safePathname(nextUrl),
            authorizeRedirectHost: authorizeInfo.authorizeRedirectHost,
            authorizeRedirectPathname: authorizeInfo.authorizeRedirectPathname,
            diagnosis: authorizeInfo.diagnosis,
            oauthLoopDetected: true,
            errorCode: "XG_SSO_PARAMETER_MISMATCH"
          };
        }
      }
      if ([301, 302, 303].includes(response.status)) {
        nextMethod = "GET";
        nextData = undefined;
      }
      logLaunchUrlType(nextUrl);
    } else if (response && response.status === 200) {
      const callbackCode = portalOauthCodeFromUrl(currentUrl);
      if (callbackCode && !portalOauthRetryDone) {
        const consumed = await consumePortalOauthCallback(cookieJar, currentUrl, previousUrl);
        portalOauthRetryDone = true;
        if (consumed) {
          console.log("[portal-launch] step=retry-sso-after-oauth");
          currentUrl = initialUrl;
          method = initialUpperMethod;
          data = initialData;
          const retryHeaders = {
            "User-Agent": userAgent(),
            "Accept": "application/json, text/plain, */*",
            "Referer": referer || PORTAL_ORIGIN + "/index",
            "X-Requested-With": "XMLHttpRequest"
          };
          if (method !== "GET") retryHeaders["Content-Type"] = "application/json;charset=UTF-8";
          response = await requestNoRedirect(cookieJar, method, currentUrl, {
            headers: retryHeaders,
            data,
            timeout: 20000
          }).catch(err => {
            console.log("[portal-launch] step=retry-sso-failed code=" + safeMessage(err));
            return null;
          });
          if (!response) {
            failedHop = hop;
            break;
          }
          continue;
        }
      }
      if (looksLikeSsoLoginPage(responseText(response), currentUrl)) {
        console.log("[portal-launch] step=sso-session-missing");
        return {
          ssoLaunchStarted: true,
          xgAuthReached,
          xgSessionEstablished: false,
          thirdpartycasFound,
          failedHop: hop,
          finalUrl: currentUrl,
          errorCode: "XG_LOGIN_REQUIRED"
        };
      }
      nextUrl = nextHtmlHop(response, currentUrl);
      if (nextUrl) {
        const parts = safeHostPath(nextUrl);
        console.log("[portal-launch] step=html-next-hop found=true host=" + parts.host + " pathname=" + parts.pathname);
        nextMethod = "GET";
        nextData = undefined;
      } else {
        failedHop = hop;
        break;
      }
    } else {
      failedHop = hop;
      break;
    }

    if (!nextUrl) break;
    previousUrl = currentUrl;
    currentUrl = nextUrl;
    method = nextMethod;
    data = nextData;
    const headers = {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": previousUrl
    };
    if (method !== "GET") headers["Content-Type"] = "application/json;charset=UTF-8";
    response = await requestNoRedirect(cookieJar, method, currentUrl, {
      headers,
      data,
      timeout: 20000
    }).catch(err => {
      console.log("[portal-launch] step=redirect-hop-failed code=" + safeMessage(err));
      return null;
    });
    if (!response) {
      failedHop = hop;
      break;
    }
  }

  if (xgAuthReached) {
    const finalParts = safeHostPath(currentUrl);
    try {
      let homeCandidate = { response, finalUrl: currentUrl, urls: [currentUrl] };
      if (isThirdpartyCasUrl(currentUrl) || isChoosePersonUrl(currentUrl)) {
        homeCandidate = await continueChoosePersonFlow(cookieJar, homeCandidate, previousUrl);
      }
      const homePage = await verifyXgHomeSession(cookieJar, homeCandidate && homeCandidate.finalUrl ? homeCandidate.finalUrl : currentUrl);
      return {
        ssoLaunchStarted: true,
        xgAuthReached: true,
        xgSessionEstablished: true,
        thirdpartycasFound,
        thirdpartycasReached: thirdpartycasFound,
        choosePersonReached: true,
        personChooseAnalyzed: true,
        personSelected: true,
        xgHomeReached: Boolean(homePage && homePage.xgHomeReached),
        xgHomeApiValid: Boolean(homePage && homePage.xgHomeApiValid),
        failedHop: 0,
        finalUrl: homePage.finalUrl || currentUrl,
        finalHost: sanitizeUrlForLog(homePage.finalUrl || currentUrl),
        finalPathname: safePathname(homePage.finalUrl || currentUrl),
        authorizeRedirectHost: authorizeInfo.authorizeRedirectHost,
        authorizeRedirectPathname: authorizeInfo.authorizeRedirectPathname,
        diagnosis: authorizeInfo.diagnosis,
        oauthLoopDetected: authorizeInfo.oauthLoopDetected,
        homePage
      };
    } catch (err) {
      return {
        ssoLaunchStarted: true,
        xgAuthReached: true,
        xgSessionEstablished: false,
        thirdpartycasFound,
        failedHop: failedHop || 10,
        finalUrl: currentUrl,
        finalHost: finalParts.host,
        finalPathname: finalParts.pathname,
        authorizeRedirectHost: authorizeInfo.authorizeRedirectHost,
        authorizeRedirectPathname: authorizeInfo.authorizeRedirectPathname,
        diagnosis: authorizeInfo.diagnosis,
        oauthLoopDetected: authorizeInfo.oauthLoopDetected,
        errorCode: (err && err.code) || "XG_LOGIN_REQUIRED"
      };
    }
  }

  const finalParts = safeHostPath(currentUrl);
  return {
    ssoLaunchStarted: true,
    xgAuthReached: false,
    xgSessionEstablished: false,
    thirdpartycasFound,
    failedHop: failedHop || 10,
    finalUrl: currentUrl,
    finalHost: finalParts.host,
    finalPathname: finalParts.pathname,
    authorizeRedirectHost: authorizeInfo.authorizeRedirectHost,
    authorizeRedirectPathname: authorizeInfo.authorizeRedirectPathname,
    diagnosis: authorizeInfo.diagnosis,
    oauthLoopDetected: authorizeInfo.oauthLoopDetected,
    errorCode: "XG_LAUNCH_URL_NOT_FOUND"
  };
}

function portalApiRequestSpec(url) {
  const path = safePathname(url);
  if (path === "/portal/publish/working/listPage") {
    return { method: "POST", data: { page: 1, size: 100 } };
  }
  if (path === "/portal/tyust/myOtherApplication") {
    return { method: "GET", params: { page: 1, size: 100, t: String(Date.now()) } };
  }
  if (path === "/portal/tyust/list") {
    return { method: "GET", params: { page: 1, size: 100, t: String(Date.now()) } };
  }
  if (path === "/portal/publish/myApplication/getKd") {
    return { method: "GET", params: { t: String(Date.now()) } };
  }
  return { method: "GET", params: {} };
}

async function requestPortalApiCandidate(cookieJar, url, referer) {
  const spec = portalApiRequestSpec(url);
  const headers = {
    "User-Agent": userAgent(),
    "Accept": "application/json, text/plain, */*",
    "Referer": referer || PORTAL_ORIGIN + "/index",
    "X-Requested-With": "XMLHttpRequest"
  };
  let requestUrl = url;
  let data = undefined;
  if (spec.method === "GET") {
    const parsed = new URL(url);
    Object.keys(spec.params || {}).forEach(key => parsed.searchParams.set(key, spec.params[key]));
    requestUrl = parsed.toString();
  } else {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    data = spec.data || {};
  }
  const response = await requestNoRedirect(cookieJar, spec.method, requestUrl, {
    headers,
    data,
    timeout: 20000
  });
  return followRedirects(cookieJar, response, requestUrl);
}

function buildPortalLaunchPayload(appRecord, analysis) {
  const raw = (appRecord && appRecord.raw) || {};
  const payload = {};
  const sources = {};
  const keys = (analysis && analysis.paramKeys || []).filter(Boolean);
  keys.forEach(key => {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== "") {
      payload[key] = raw[key];
      sources[key] = key;
    }
  });
  if (keys.includes("url") && !payload.url && raw.appUrl) {
    payload.url = raw.appUrl;
    sources.url = "appUrl";
  }
  if (keys.includes("code") && !payload.code && raw.rjid) {
    payload.code = raw.rjid;
    sources.code = "rjid";
  }
  return { payload, sources };
}

function compareSsoParameterSources(appRecord, oauthCode) {
  const raw = (appRecord && appRecord.raw) || {};
  if (raw.appUrl) console.log("[portal-launch] candidate urlSource=appUrl");
  if (raw.rjurl) console.log("[portal-launch] candidate urlSource=rjurl");
  if (raw.rjid) console.log("[portal-launch] candidate codeSource=rjid");
  if (oauthCode) console.log("[portal-launch] candidate codeSource=oauthCode");
}

function analyzePortalClickFunction(jsTexts) {
  const analysis = analyzeRedirectUrlExpressions(jsTexts);
  console.log("[portal-click] function=redirectUrl");
  console.log("[portal-click] redirectFunctionFound=" + Boolean(analysis.found));
  if (analysis.found) {
    console.log("[portal-click] branch=" + analysis.externalBranch + " action=" + analysis.externalAction + " urlSource=" + analysis.externalUrlSource);
    console.log("[portal-click] branch=" + analysis.internalBranch + " action=" + analysis.internalAction + " urlSource=" + analysis.internalUrlSource);
    console.log("[portal-click] checks=" + analysis.checks);
    console.log("[portal-click] attachesParams=false");
    console.log("[portal-click] preflightApi=false");
  }
  return analysis;
}

function selectPortalClickTarget(appRecord, clickAnalysis) {
  const raw = (appRecord && appRecord.raw) || {};
  const innerOrOuter = String(raw.innerOrOuter || "");
  const branch = innerOrOuter === "1" ? "external" : "internal";
  let source = "none";
  let selectedUrl = "";
  let action = "unknown";
  if (branch === "external") {
    action = "window.open";
    if (raw.rjurl) {
      source = "rjurl";
      selectedUrl = raw.rjurl;
    } else if (raw.appUrl) {
      source = "appUrl";
      selectedUrl = raw.appUrl;
    }
  } else {
    action = "router.push";
    if (raw.appUrl) {
      source = "appUrl";
      selectedUrl = raw.appUrl;
    }
  }
  const selected = selectedUrl ? safeHostPath(selectedUrl) : { host: "none", pathname: "none" };
  console.log("[portal-click] appName=" + appRecordName(raw));
  console.log("[portal-click] innerOrOuter=" + (raw.innerOrOuter !== undefined ? raw.innerOrOuter : "unknown"));
  console.log("[portal-click] isRj=" + (raw.isRj !== undefined ? raw.isRj : "unknown"));
  console.log("[portal-click] urlType=" + (raw.urlType !== undefined ? raw.urlType : "unknown"));
  console.log("[portal-click] serviceScene=" + (raw.serviceScene !== undefined ? raw.serviceScene : "unknown"));
  const appUrlParts = safeHostPath(raw.appUrl || "");
  const rjurlParts = safeHostPath(raw.rjurl || "");
  console.log("[portal-click] appUrlHost=" + appUrlParts.host + " appUrlPathname=" + appUrlParts.pathname);
  console.log("[portal-click] rjurlHost=" + rjurlParts.host + " rjurlPathname=" + rjurlParts.pathname);
  console.log("[portal-click] selectedBranch=" + branch);
  console.log("[portal-click] selectedUrlSource=" + source);
  console.log("[portal-click] action=" + action);
  console.log("[portal-click] selectedHost=" + selected.host);
  console.log("[portal-click] selectedPathname=" + selected.pathname);
  return {
    redirectFunctionFound: Boolean(clickAnalysis && clickAnalysis.found),
    selectedBranch: branch,
    selectedUrlSource: source,
    selectedUrl,
    selectedHost: selected.host,
    selectedPathname: selected.pathname,
    action
  };
}

async function launchXgAppByPortalClick(cookieJar, xgApp, clickAnalysis, portalBase) {
  if (!xgApp || !xgApp.record) return null;
  const target = selectPortalClickTarget(xgApp.record, clickAnalysis);
  if (!target.selectedUrl || target.action !== "window.open") {
    return Object.assign({}, target, {
      directXgLaunchStarted: false,
      errorCode: "XG_LAUNCH_URL_NOT_FOUND"
    });
  }

  console.log("[portal-click] step=request-selected-url" +
    " urlSource=" + target.selectedUrlSource +
    " host=" + target.selectedHost +
    " pathname=" + target.selectedPathname);
  const response = await requestNoRedirect(cookieJar, "GET", target.selectedUrl, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": portalBase || PORTAL_ORIGIN + "/index"
    },
    timeout: 20000
  }).catch(err => {
    console.log("[portal-click] step=request-selected-url-failed code=" + safeMessage(err));
    return null;
  });
  if (!response) {
    return Object.assign({}, target, {
      directXgLaunchStarted: true,
      errorCode: "XG_LOGIN_REQUIRED"
    });
  }
  const location = response.headers && response.headers.location ? absoluteUrl(response.headers.location, target.selectedUrl) : "";
  const locationParts = location ? safeHostPath(location) : { host: "none", pathname: "none" };
  console.log("[portal-click] step=request-selected-url-result" +
    " urlSource=" + target.selectedUrlSource +
    " host=" + target.selectedHost +
    " pathname=" + target.selectedPathname +
    " status=" + response.status +
    " hasLocation=" + Boolean(location) +
    " locationHost=" + locationParts.host +
    " locationPathname=" + locationParts.pathname);

  const traced = await followLaunchRedirectChain(cookieJar, {
    response,
    requestUrl: target.selectedUrl
  }, "GET", undefined, portalBase, { portalDiagnosis: "unexpected-portal-oauth" });
  return Object.assign({}, target, traced, {
    directXgLaunchStarted: true
  });
}

function thirdpartyCasFromPage(page, baseUrl) {
  const urls = [];
  if (page && Array.isArray(page.urls)) urls.push(...page.urls);
  if (page && page.finalUrl) urls.push(page.finalUrl);
  const text = page && page.response ? responseText(page.response) : "";
  urls.push(...thirdpartyCasUrlsFromText(text, baseUrl || (page && page.finalUrl) || PORTAL_ORIGIN + "/index"));
  return Array.from(new Set(urls)).find(url => isThirdpartyCasUrl(url)) || "";
}

async function launchXgAppThroughPortal(cookieJar, xgApp, ssoAnalysis, portalBase, oauthCode) {
  if (!xgApp || !xgApp.record) return null;
  const method = String((ssoAnalysis && ssoAnalysis.method) || "UNKNOWN").toUpperCase();
  const paramKeys = (ssoAnalysis && ssoAnalysis.paramKeys) || [];
  if (!["GET", "POST"].includes(method) || !paramKeys.length) {
    console.log("[portal-launch] step=skip-sso reason=missing-method-or-paramKeys");
    return null;
  }

  compareSsoParameterSources(xgApp.record, oauthCode);
  const raw = (xgApp.record && xgApp.record.raw) || {};
  const appUrlParts = safeHostPath(raw.appUrl || "");
  const rjurlParts = safeHostPath(raw.rjurl || "");
  const built = buildPortalLaunchPayload(xgApp.record, ssoAnalysis);
  const payload = built.payload;
  const sources = built.sources || {};
  console.log("[portal-launch] urlSource=" + (sources.url || "unknown"));
  console.log("[portal-launch] codeSource=" + (sources.code || "unknown"));
  console.log("[portal-launch] appUrlHost=" + appUrlParts.host + " appUrlPathname=" + appUrlParts.pathname);
  console.log("[portal-launch] rjurlHost=" + rjurlParts.host + " rjurlPathname=" + rjurlParts.pathname);
  const payloadKeys = Object.keys(payload);
  if (!payloadKeys.length) {
    console.log("[portal-launch] step=skip-sso reason=missing-app-fields paramKeys=" + paramKeys.join(","));
    return null;
  }

  const ssoUrl = PORTAL_ORIGIN + "/portal/sso/re";
  console.log("[portal-launch] step=request-sso method=" + method + " paramKeys=" + payloadKeys.join(","));
  const launch = await requestPortalLaunch(cookieJar, ssoUrl, method, payload, portalBase).catch(err => {
    console.log("[portal-launch] step=sso-failed code=" + safeMessage(err));
    return null;
  });
  if (!launch || !launch.response) return null;

  logPortalLaunchResponse(launch.response, launch.requestUrl);
  const launchUrl = extractLaunchUrl(launch.response, launch.requestUrl);
  if (launchUrl) {
    const parts = safeHostPath(launchUrl);
    console.log("[portal-launch] step=extract-launch-url found=true host=" + parts.host + " pathname=" + parts.pathname);
    console.log("[xg-session] step=find-thirdpartycas found=true");
  } else {
    console.log("[portal-launch] step=extract-launch-url found=false");
  }

  const traced = await followLaunchRedirectChain(cookieJar, launch, method, payload, portalBase);
  if (launchUrl && !traced.launchUrl) traced.launchUrl = launchUrl;
  if (launchUrl && isThirdpartyCasUrl(launchUrl)) traced.thirdpartycasFound = true;
  return traced;
}

async function fetchPortalJsAssets(cookieJar, jsUrls, portalBase) {
  const texts = [];
  for (const url of jsUrls.slice(0, 12)) {
    console.log("[portal-api] step=fetch-js host=" + sanitizeUrlForLog(url) + " pathname=" + safePathname(url));
    const page = await getPortalResource(cookieJar, url, portalBase).catch(err => {
      console.log("[portal-api] step=fetch-js-failed code=" + safeMessage(err));
      return null;
    });
    if (!page || !page.response) continue;
    const text = responseText(page.response);
    const lower = text.toLowerCase();
    console.log("[portal-api] step=fetch-js-result status=" + page.response.status +
      " host=" + sanitizeUrlForLog(page.finalUrl) +
      " pathname=" + safePathname(page.finalUrl) +
      " hasAxios=" + lower.includes("axios") +
      " hasAppKeyword=" + APP_API_HINTS.some(hint => lower.includes(hint)));
    texts.push(text);
  }
  return texts;
}

async function discoverXgAppFromPortalApis(cookieJar, apiCandidates, portalBase) {
  const checked = [];
  for (const apiUrl of apiCandidates.filter(url => portalApiScore(url) > 0 && isAppListCandidate(url)).slice(0, 30)) {
    checked.push(apiUrl);
    const spec = portalApiRequestSpec(apiUrl);
    console.log("[portal-api] step=request method=" + spec.method + " host=" + sanitizeUrlForLog(apiUrl) + " pathname=" + safePathname(apiUrl));
    const page = await requestPortalApiCandidate(cookieJar, apiUrl, portalBase).catch(err => {
      console.log("[portal-api] step=request-failed code=" + safeMessage(err));
      return null;
    });
    if (!page || !page.response) continue;
    const text = responseText(page.response);
    const json = parseJsonMaybe(page.response.data);
    console.log("[portal-api] step=response status=" + page.response.status +
      " host=" + sanitizeUrlForLog(page.finalUrl) +
      " pathname=" + safePathname(page.finalUrl) +
      " isJson=" + Boolean(json) +
      " containsXg=" + text.includes("xg.tyust.edu.cn") +
      " containsXgManage=" + containsXgAppKeyword(text));

    if (!json) continue;
    const records = findXgAppRecords(json, page.finalUrl);
    if (!records.length) continue;

    const withTarget = records.find(record => record.targetUrls && record.targetUrls.length) || records[0];
    const target = (withTarget.targetUrls || [])[0] || "";
    console.log("[portal-api] step=app-list-success host=" + sanitizeUrlForLog(apiUrl) + " pathname=" + safePathname(apiUrl));
    console.log("[xg-session] step=find-xg-app found=true");
    console.log("[xg-session] appName=" + withTarget.name);
    console.log("[xg-session] fieldKeys=" + Object.keys(withTarget.raw || {}).slice(0, 40).join(","));
    console.log("[xg-session] targetHost=" + (target ? sanitizeUrlForLog(target) : "none"));
    return {
      apiUrl,
      record: withTarget,
      targetUrls: Array.from(new Set(records.flatMap(record => record.targetUrls || [])))
    };
  }

  console.log("[portal-api] step=app-list-failed checked=" + checked.length);
  return null;
}

function logSuspiciousRefs(refs) {
  refs.slice(0, 20).forEach((url, index) => {
    console.log("[xg-session] step=suspicious-ref index=" + index +
      " host=" + sanitizeUrlForLog(url) +
      " pathname=" + safePathname(url));
  });
}

function scoreUrlFromHtml(html, baseUrl) {
  const links = collectLinks(html, baseUrl, url => url.includes(SCORE_PAGE_NAME));
  return links[0] || "";
}

function appLinksFromHtml(html, baseUrl) {
  return collectLinks(html, baseUrl, (url, text) => {
    const haystack = (url + " " + text).toLowerCase();
    return haystack.includes("app_studentjudge") ||
      haystack.includes("studentjudge") ||
      haystack.includes("综合测评") ||
      haystack.includes("学习成绩") ||
      haystack.includes("基础成绩");
  });
}

function scoreUrlFromSessionPath(url) {
  try {
    const parsed = new URL(String(url || ""));
    const match = parsed.pathname.match(/^(.*\/apps\/App_StudentJudge\/(?:\(S\([^/]+\)\/)?)/i);
    if (!match) return "";
    return parsed.origin + match[1] + SCORE_PAGE_NAME;
  } catch (err) {
    return "";
  }
}

async function getPage(cookieJar, url, referer) {
  const response = await requestNoRedirect(cookieJar, "GET", url, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": referer || PORTAL_ORIGIN + "/index"
    },
    timeout: 20000
  });
  return followRedirects(cookieJar, response, url);
}

function xgHomeLooksValid(html) {
  const text = String(html || "");
  return ["快捷功能", "学生基本信息", "待办事项", "当前层次", "当前单位"]
    .some(keyword => text.includes(keyword));
}

async function requestChoosePersonPage(cookieJar, thirdpartyPage, referer) {
  const html = responseText(thirdpartyPage.response);
  const baseUrl = thirdpartyPage.finalUrl || referer || XG_ORIGIN + "/userhall/login/thirdpartycas";
  const state = extractThirdpartyCasState(html, baseUrl);
  if (state.status && state.status !== "1") {
    throw makeError("XG_THIRDPARTY_CAS_FAILED", "thirdpartycas did not report success");
  }
  if (state.accesstype === "1" && state.turl) {
    return getPage(cookieJar, state.turl, baseUrl);
  }
  const form = extractChoosePersonForm(html, baseUrl);
  const urls = extractChoosePersonUrls(html, baseUrl);
  const preferredUrl = urls.find(url => {
    try { return new URL(url).searchParams.has("tk"); } catch (err) { return false; }
  }) || state.chooseUrl || urls.find(url => safeQueryKeys(url).length > 0) || urls[0] || "";
  const chooseUrl = (form && form.action && ((() => {
    try { return new URL(form.action).searchParams.has("tk"); } catch (err) { return false; }
  })() || !preferredUrl)) ? form.action : preferredUrl;
  if (!chooseUrl) {
    console.log("[xg-session] step=choose-person-page detected=false");
    throw makeError("XG_CHOOSE_PERSON_INVALID", "ChoosePerson URL was not found");
  }
  const method = form && form.method ? form.method : "GET";
  const payload = form && form.payload ? form.payload : {};
  const payloadKeys = Object.keys(payload);
  console.log("[xg-session] step=choose-person-request" +
    " method=" + method +
    " candidates=" + urls.length +
    " host=" + sanitizeUrlForLog(chooseUrl) +
    " pathname=" + safePathname(chooseUrl) +
    " queryKeys=" + (safeQueryKeys(chooseUrl).join(",") || "none") +
    " hiddenKeys=" + (payloadKeys.filter(key => !/^(tk|ticket|token|code)$/i.test(key)).join(",") || "none") +
    " hasTk=" + (payloadKeys.some(key => key.toLowerCase() === "tk") || (() => {
      try { return new URL(chooseUrl).searchParams.has("tk"); } catch (err) { return false; }
    })()));
  const headers = {
      "User-Agent": userAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": baseUrl
  };
  let requestUrl = chooseUrl;
  let data = undefined;
  if (method === "GET") {
    const parsed = new URL(chooseUrl);
    payloadKeys.forEach(key => parsed.searchParams.set(key, payload[key]));
    requestUrl = parsed.toString();
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    data = new URLSearchParams(payload).toString();
  }
  const response = await requestNoRedirect(cookieJar, method, requestUrl, {
    headers,
    data,
    timeout: 20000
  }).catch(err => {
    console.log("[xg-session] step=choose-person-page-failed code=" + safeMessage(err));
    return null;
  });
  if (!response) throw makeError("XG_CHOOSE_PERSON_INVALID", "ChoosePerson request failed");
  console.log("[xg-session] step=choose-person-page detected=true" +
    " status=" + response.status +
    " contentType=" + (contentTypeOf(response) || "none") +
    " setCookieCount=" + setCookieCount(response));
  return { response, finalUrl: chooseUrl, urls: [chooseUrl] };
}

async function analyzeAndChoosePerson(cookieJar, choosePage) {
  const html = responseText(choosePage.response);
  const scripts = extractScriptUrls(html, choosePage.finalUrl);
  const scriptTexts = await fetchXgScriptTexts(cookieJar, scripts, choosePage.finalUrl);
  const texts = [html].concat(scriptTexts);
  const analysis = analyzePersonChooseRequest(texts);
  const domCandidates = collectPersonCandidatesFromChooseDom(html);
  const candidates = domCandidates.length ? domCandidates : collectPersonCandidatesFromText(texts.join("\n"));
  if (domCandidates.length) {
    analysis.found = true;
    analysis.method = "POST";
    analysis.contentType = "application/x-www-form-urlencoded";
    analysis.payloadKeys = ["account", "lv", "token", "type"];
    analysis.endpoint = "";
  }
  console.log("[xg-session] step=analyze-person-choose" +
    " method=" + analysis.method +
    " contentType=" + analysis.contentType +
    " payloadKeys=" + (analysis.payloadKeys.length ? analysis.payloadKeys.join(",") : "none") +
    " personCount=" + candidates.length);
  if (!analysis.found) throw makeError("XG_PERSON_CHOOSE_NOT_FOUND", "person choose endpoint was not found");

  const selected = selectPersonCandidate(candidates);
  console.log("[xg-session] step=select-person" +
    " candidateCount=" + candidates.length +
    " selected=" + Boolean(selected) +
    " roleType=" + (selected ? "student" : "unknown") +
    " hasAccount=" + Boolean(selected && selected.account) +
    " hasLv=" + Boolean(selected && selected.lv) +
    " hasToken=" + Boolean(selected && selected.token));
  if (!selected) throw makeError("XG_PERSON_CHOOSE_NOT_FOUND", "No person candidate was found");

  const payload = buildPersonChoosePayload(selected, analysis.payloadKeys);
  const payloadKeys = Object.keys(payload);

  const headers = {
    "User-Agent": userAgent(),
    "Accept": "application/json, text/plain, */*",
    "Origin": XG_ORIGIN,
    "Referer": choosePage.finalUrl,
    "X-Requested-With": "XMLHttpRequest"
  };
  let requestUrl = selected && selected.chooseUrl ? absoluteUrl(selected.chooseUrl, choosePage.finalUrl) : XG_ORIGIN + analysis.endpoint;
  let data = undefined;
  if (analysis.method === "GET") {
    const parsed = new URL(requestUrl);
    payloadKeys.forEach(key => parsed.searchParams.set(key, payload[key]));
    requestUrl = parsed.toString();
  } else {
    if (selected && selected.captchaToken) headers["Captcha-Token"] = selected.captchaToken;
    headers["Content-Type"] = analysis.contentType === "application/json" || analysis.contentType === "unknown"
      ? "application/json;charset=UTF-8"
      : analysis.contentType;
    const authHeaders = await prepareXgUAjaxHeaders(
      cookieJar,
      selected,
      requestUrl,
      payload,
      choosePage.finalUrl,
      selected && selected.chooseUrl ? selected.chooseUrl : requestUrl
    );
    Object.assign(headers, authHeaders);
    data = headers["Content-Type"].includes("application/x-www-form-urlencoded")
      ? new URLSearchParams(payload).toString()
      : payload;
  }

  console.log("[xg-session] step=person-choose-request" +
    " method=" + analysis.method +
    " payloadKeys=" + (payloadKeys.length ? payloadKeys.join(",") : "none") +
    " authHeaders=" + Boolean(headers["Content-AuthToken"] && headers["Content-AuthSign"]));

  const response = await requestNoRedirect(cookieJar, analysis.method, requestUrl, {
    headers,
    data,
    timeout: 20000
  }).catch(err => {
    console.log("[xg-session] step=person-choose-failed code=" + safeMessage(err));
    return null;
  });
  if (!response) throw makeError("XG_PERSON_CHOOSE_FAILED", "person choose request failed");

  const json = parseJsonMaybe(response.data);
  const stringValues = [];
  if (json) collectStringValues(json, stringValues);
  const hasNextUrl = Boolean((response.headers && response.headers.location) ||
    stringValues.some(value => extractUrlsFromString(value, requestUrl).length));
  console.log("[xg-session] step=person-choose-result" +
    " status=" + response.status +
    " isJson=" + Boolean(json) +
    " jsonKeys=" + (jsonKeysOf(response.data).join(",") || "none") +
    " resStatus=" + (json && json.ResStatus !== undefined ? json.ResStatus : "none") +
    " appStatus=" + (json && json.Status !== undefined ? json.Status : "none") +
    " hasTurnUrl=" + Boolean(json && json.TurnUrl) +
    " hasNextUrl=" + hasNextUrl);
  if (response.status >= 400) throw makeError("XG_PERSON_CHOOSE_FAILED", "person choose returned error");
  return { response, requestUrl };
}

function nextUrlFromResponse(response, baseUrl) {
  const location = response && response.headers && response.headers.location;
  if (location) return absoluteUrl(location, baseUrl);
  const extracted = extractLaunchUrl(response, baseUrl);
  if (extracted) return extracted;
  const text = responseText(response);
  const urls = extractAnyHtmlRedirectUrls(text, baseUrl)
    .filter(url => hostOf(url) === "xg.tyust.edu.cn");
  return urls[0] || "";
}

async function verifyXgHomeApi(cookieJar, referer) {
  const apiUrl = XG_ORIGIN + "/userhall/api/home/service/type";
  const response = await requestNoRedirect(cookieJar, "GET", apiUrl, {
    headers: {
      "User-Agent": userAgent(),
      "Accept": "application/json, text/plain, */*",
      "Referer": referer || XG_ORIGIN + "/userhall/Sec/Page/Index",
      "X-Requested-With": "XMLHttpRequest"
    },
    timeout: 20000
  }).catch(err => {
    console.log("[xg-session] step=verify-xg-home-api-failed code=" + safeMessage(err));
    return null;
  });
  if (!response) return false;
  const text = responseText(response);
  const valid = response.status >= 200 && response.status < 400 && !isLoginTimeoutHtml(text);
  console.log("[xg-session] step=verify-xg-home-api" +
    " status=" + response.status +
    " isJson=" + Boolean(parseJsonMaybe(response.data)) +
    " valid=" + valid);
  return valid;
}

async function continueChoosePersonFlow(cookieJar, page, referer) {
  if (!page || !page.response) throw makeError("XG_THIRDPARTY_CAS_FAILED", "thirdpartycas response missing");
  const thirdpartyLocation = page.response.headers && page.response.headers.location
    ? absoluteUrl(page.response.headers.location, page.finalUrl || referer)
    : "";
  console.log("[xg-session] step=thirdpartycas-result" +
    " status=" + page.response.status +
    " contentType=" + (contentTypeOf(page.response) || "none") +
    " hasLocation=" + Boolean(thirdpartyLocation) +
    " locationHost=" + (thirdpartyLocation ? sanitizeUrlForLog(thirdpartyLocation) : "none") +
    " locationPathname=" + (thirdpartyLocation ? safePathname(thirdpartyLocation) : "none") +
    " setCookieCount=" + setCookieCount(page.response));
  const thirdpartyHtml = responseText(page.response);
  logThirdpartycasHints(thirdpartyHtml, page.finalUrl || referer);
  const thirdpartyScripts = extractScriptUrls(thirdpartyHtml, page.finalUrl || referer);
  const thirdpartyScriptTexts = await fetchXgScriptTexts(cookieJar, thirdpartyScripts, page.finalUrl || referer);
  const loginApiCandidates = extractXgLoginApiCandidates([thirdpartyHtml].concat(thirdpartyScriptTexts), page.finalUrl || referer);
  console.log("[xg-session] step=login-api-candidates count=" + loginApiCandidates.length);
  loginApiCandidates.slice(0, 20).forEach(url => {
    console.log("[xg-session] loginApi=" + safePathname(url));
  });
  if (isLoginTimeoutPage(page)) throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");

  const choosePage = isChoosePersonUrl(page.finalUrl)
    ? page
    : await requestChoosePersonPage(cookieJar, page, referer);
  const chooseResult = await analyzeAndChoosePerson(cookieJar, choosePage);
  const nextUrl = nextUrlFromResponse(chooseResult.response, chooseResult.requestUrl) ||
    XG_ORIGIN + "/userhall/Sec/Page/Index";
  const homePage = await getPage(cookieJar, nextUrl, choosePage.finalUrl).catch(err => {
    console.log("[xg-session] step=go-xg-home-failed code=" + safeMessage(err));
    return null;
  });
  if (!homePage || !homePage.response) throw makeError("XG_LOGIN_REQUIRED", "Unable to open xg home");
  return homePage;
}

function logChoosePersonFromRedirectTrace(page) {
  const urls = Array.isArray(page && page.urls) ? page.urls : [];
  if (!urls.some(url => isChoosePersonUrl(url))) return;
  console.log("[xg-session] step=choose-person detected=true");
  console.log("[xg-session] step=choose-person-result status=" + (page && page.response ? page.response.status : "none") +
    " finalHost=" + sanitizeUrlForLog(page && page.finalUrl));
}

async function verifyXgHomeSession(cookieJar, referer) {
  const homeUrl = XG_ORIGIN + "/userhall/Sec/Page/Index";
  const page = await getPage(cookieJar, homeUrl, referer || XG_ORIGIN + "/userhall/login/thirdpartycas").catch(err => {
    console.log("[xg-session] step=verify-xg-home-failed code=" + safeMessage(err));
    return null;
  });
  if (!page || !page.response) throw makeError("XG_LOGIN_REQUIRED", "Unable to open xg home");
  if (isLoginTimeoutPage(page)) throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");

  const html = responseText(page.response);
  const pageValid = hostOf(page.finalUrl) === "xg.tyust.edu.cn" &&
    !isLoginTimeoutPage(page) &&
    !isChoosePersonUrl(page.finalUrl) &&
    !String(page.finalUrl || "").toLowerCase().includes("chooseperson") &&
    xgCookieCount(cookieJar) > 0 &&
    xgHomeLooksValid(html);
  const homeApiValid = pageValid ? await verifyXgHomeApi(cookieJar, page.finalUrl) : false;
  const ok = pageValid && homeApiValid;
  console.log("[xg-session] step=verify-xg-home" +
    " pageValid=" + pageValid +
    " homeApiValid=" + homeApiValid);
  console.log("[xg-session] step=xg-session-established ok=" + ok +
    " status=" + page.response.status +
    " finalHost=" + sanitizeUrlForLog(page.finalUrl));
  if (!ok) throw makeError("XG_LOGIN_REQUIRED", "XG home was not established");
  page.xgHomeReached = pageValid;
  page.xgHomeApiValid = homeApiValid;
  return page;
}

async function launchThirdpartyCas(cookieJar, launchUrl, referer) {
  console.log("[xg-session] step=launch-thirdpartycas host=" + sanitizeUrlForLog(launchUrl));
  const page = await getPage(cookieJar, launchUrl, referer || PORTAL_ORIGIN + "/index").catch(err => {
    console.log("[xg-session] step=launch-thirdpartycas-failed code=" + safeMessage(err));
    return null;
  });
  if (!page || !page.response) throw makeError("XG_LOGIN_REQUIRED", "thirdpartycas request failed");

  console.log("[xg-session] step=launch-thirdpartycas-result status=" + page.response.status +
    " finalHost=" + sanitizeUrlForLog(page.finalUrl));
  console.log("[xg-session] step=xg-cookie-established cookieCount=" + xgCookieCount(cookieJar));
  if (isLoginTimeoutPage(page)) throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");

  logChoosePersonFromRedirectTrace(page);
  const continued = await continueChoosePersonFlow(cookieJar, page, launchUrl);
  return verifyXgHomeSession(cookieJar, continued && continued.finalUrl ? continued.finalUrl : launchUrl);
}

function scorePageLooksValid(finalUrl, html, cookieHeader) {
  const host = hostOf(finalUrl);
  const text = String(html || "");
  const hasGridView = text.includes("GridView1");
  const hasYearTime = text.includes("YearTime");
  const hasViewStateScore = text.includes("__VIEWSTATE") && text.includes(SCORE_PAGE_NAME);
  const cookieLength = String(cookieHeader || "").length;
  return host === "xg.tyust.edu.cn" &&
    !isLoginTimeoutUrl(finalUrl) &&
    !isLoginTimeoutHtml(text) &&
    (hasGridView || hasYearTime || hasViewStateScore) &&
    cookieLength > 42;
}

async function verifyScoreUrl(cookieJar, scoreUrl, referer) {
  if (!scoreUrl) return null;
  console.log("[xg-session] step=verify-score-url host=" + sanitizeUrlForLog(scoreUrl) + " pathname=" + safePathname(scoreUrl));
  const scorePage = await getPage(cookieJar, scoreUrl, referer).catch(err => {
    console.log("[xg-session] step=verify-score-url-failed code=" + safeMessage(err));
    return null;
  });
  if (!scorePage || !scorePage.response) return null;

  const html = String(scorePage.response.data || "");
  const finalScoreUrl = scorePage.finalUrl || scoreUrl;
  const cookies = cookieHeaderFor(cookieJar, finalScoreUrl);
  const timeout = isLoginTimeoutPage(scorePage);
  const valid = scorePageLooksValid(finalScoreUrl, html, cookies);
  console.log("[xg-session] step=verify-score-url-result status=" + scorePage.response.status +
    " host=" + sanitizeUrlForLog(finalScoreUrl) +
    " pathname=" + safePathname(finalScoreUrl) +
    " containsGridView1=" + html.includes("GridView1") +
    " containsYearTime=" + html.includes("YearTime") +
    " containsViewState=" + html.includes("__VIEWSTATE") +
    " loginTimeout=" + timeout +
    " cookieLength=" + cookies.length +
    " valid=" + valid);

  if (timeout) throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  if (!valid) return null;
  return { scoreUrl: finalScoreUrl, cookies, cookieJar };
}

async function validateCachedSession(activeStorage) {
  if (!activeStorage || typeof activeStorage.getXgSession !== "function") {
    console.log("[xg-session] step=load-cache hasStorage=false hasScoreUrl=false hasCookies=false cookieLength=0");
    return null;
  }
  const session = activeStorage.getXgSession();
  console.log("[xg-session] step=load-cache hasScoreUrl=" + Boolean(session && session.scoreUrl) +
    " hasCookies=" + Boolean(session && session.cookies) +
    " cookieLength=" + String((session && session.cookies) || "").length);
  if (!session || !session.scoreUrl || !session.cookies) return null;

  console.log("[xg-session] step=validate-cache ok=true host=" + sanitizeUrlForLog(session.scoreUrl) +
    " pathname=" + safePathname(session.scoreUrl));
  return {
    scoreUrl: session.scoreUrl,
    cookies: session.cookies,
    fromCache: true
  };
}

async function legacyDiscoverScoreSession(cookieJar) {
  console.log("[xg-session] step=discover-start");

  const portal = await getAndFollow(cookieJar, PORTAL_ORIGIN + "/index", PORTAL_ORIGIN + "/index").catch(() => null);
  const portalHtml = portal && portal.response ? String(portal.response.data || "") : "";
  console.log("[xg-session] step=enter-portal host=" + (portal ? sanitizeUrlForLog(portal.finalUrl) : "unknown") +
    " status=" + (portal && portal.response ? portal.response.status : "none") +
    " containsXg=" + portalHtml.includes("xg.tyust.edu.cn") +
    " containsXgManage=" + portalHtml.includes("学工管理") +
    " containsStudentJudge=" + portalHtml.toLowerCase().includes("app_studentjudge"));

  const portalBase = portal ? portal.finalUrl : PORTAL_ORIGIN + "/index";
  const suspiciousRefs = collectSuspiciousRefs(portalHtml, portalBase);
  console.log("[xg-session] step=portal-suspicious refs=" + suspiciousRefs.length);
  logSuspiciousRefs(suspiciousRefs);

  const discoveredTexts = [portalHtml];
  for (const ref of suspiciousRefs.slice(0, 20)) {
    if (hostOf(ref) && hostOf(ref) !== "ronghemenhu.tyust.edu.cn") continue;
    console.log("[xg-session] step=probe-portal-ref host=" + sanitizeUrlForLog(ref) + " pathname=" + safePathname(ref));
    const refPage = await getPage(cookieJar, ref, portalBase).catch(err => {
      console.log("[xg-session] step=probe-portal-ref-failed code=" + safeMessage(err));
      return null;
    });
    if (!refPage || !refPage.response) continue;
    const refHtml = typeof refPage.response.data === "string" ? refPage.response.data : JSON.stringify(refPage.response.data || "");
    console.log("[xg-session] step=probe-portal-ref-result status=" + refPage.response.status +
      " host=" + sanitizeUrlForLog(refPage.finalUrl) +
      " containsXg=" + refHtml.includes("xg.tyust.edu.cn") +
      " containsXgManage=" + refHtml.includes("学工管理") +
      " containsStudentJudge=" + refHtml.toLowerCase().includes("app_studentjudge"));
    discoveredTexts.push(refHtml);
  }

  const portalLinks = Array.from(new Set(discoveredTexts.flatMap(text => xgUrlsFromText(text, portalBase))
    .concat(appLinksFromHtml(portalHtml, portalBase))
    .filter(url => sanitizeUrlForLog(url) === "xg.tyust.edu.cn")));
  console.log("[xg-session] step=find-xg-entry found=" + Boolean(portalLinks.length) + " count=" + portalLinks.length);

  if (!portalLinks.length) {
    console.log("[xg-session] step=failed code=XG_APP_NOT_FOUND");
    throw makeError("XG_APP_NOT_FOUND", "XG app entry was not found");
  }

  const candidates = Array.from(new Set(portalLinks));

  for (const candidate of candidates) {
    console.log("[xg-session] step=enter-xg host=" + sanitizeUrlForLog(candidate) + " pathname=" + safePathname(candidate));
    const page = await getPage(cookieJar, candidate, PORTAL_ORIGIN + "/index").catch(err => {
      console.log("[xg-session] step=enter-xg-failed code=" + safeMessage(err));
      return null;
    });
    if (!page || !page.response) continue;
    console.log("[xg-session] step=enter-xg-result status=" + page.response.status +
      " host=" + sanitizeUrlForLog(page.finalUrl) +
      " pathname=" + safePathname(page.finalUrl));
    if (isLoginTimeoutPage(page)) {
      console.log("[xg-session] step=enter-xg-timeout code=XG_LOGIN_REQUIRED");
      throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
    }

    const html = String(page.response.data || "");
    const directScore = scoreUrlFromHtml(html, page.finalUrl) || (String(page.finalUrl || "").includes(SCORE_PAGE_NAME) ? page.finalUrl : "");
    console.log("[xg-session] step=find-score-url found=" + Boolean(directScore) +
      " containsGridView1=" + html.includes("GridView1") +
      " containsAppStudentJudge=" + html.toLowerCase().includes("app_studentjudge"));
    if (directScore) {
      const verified = await verifyScoreUrl(cookieJar, directScore, page.finalUrl);
      if (verified) {
        console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
          " pathname=" + safePathname(verified.scoreUrl) +
          " cookieLength=" + verified.cookies.length);
        return verified;
      }
    }

    const appLinks = appLinksFromHtml(html, page.finalUrl);
    console.log("[xg-session] step=find-app-studentjudge found=" + Boolean(appLinks.length) + " count=" + appLinks.length);
    const nestedCandidates = Array.from(new Set([
      ...appLinks,
      scoreUrlFromSessionPath(page.finalUrl)
    ].filter(Boolean)));

    for (const nested of nestedCandidates) {
      console.log("[xg-session] step=visit-app host=" + sanitizeUrlForLog(nested) + " pathname=" + safePathname(nested));
      const nestedPage = await getPage(cookieJar, nested, page.finalUrl).catch(err => {
        console.log("[xg-session] step=visit-app-failed code=" + safeMessage(err));
        return null;
      });
      if (!nestedPage || !nestedPage.response) continue;

      const nestedHtml = String(nestedPage.response.data || "");
      console.log("[xg-session] step=visit-app-result status=" + nestedPage.response.status +
        " host=" + sanitizeUrlForLog(nestedPage.finalUrl) +
        " pathname=" + safePathname(nestedPage.finalUrl) +
        " containsGridView1=" + nestedHtml.includes("GridView1") +
        " containsScorePage=" + nestedHtml.includes(SCORE_PAGE_NAME));
      if (isLoginTimeoutPage(nestedPage)) {
        console.log("[xg-session] step=visit-app-timeout code=XG_LOGIN_REQUIRED");
        throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
      }
      const scoreUrl = scoreUrlFromHtml(nestedHtml, nestedPage.finalUrl) ||
        (String(nestedPage.finalUrl || "").includes(SCORE_PAGE_NAME) ? nestedPage.finalUrl : "") ||
        scoreUrlFromSessionPath(nestedPage.finalUrl);
      console.log("[xg-session] step=find-score-url found=" + Boolean(scoreUrl) +
        " host=" + (scoreUrl ? sanitizeUrlForLog(scoreUrl) : "none") +
        " pathname=" + (scoreUrl ? safePathname(scoreUrl) : "none"));
      if (!scoreUrl) continue;

      const verified = await verifyScoreUrl(cookieJar, scoreUrl, nestedPage.finalUrl);
      if (verified) {
        console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
          " pathname=" + safePathname(verified.scoreUrl) +
          " cookieLength=" + verified.cookies.length);
        return verified;
      }
    }
  }

  console.log("[xg-session] step=find-score-url found=false code=XG_SCORE_URL_NOT_FOUND");
  throw makeError("XG_SCORE_URL_NOT_FOUND", "Unable to find xg score page");
}

async function inspectXgCandidate(cookieJar, candidate, referer) {
  if (isThirdpartyCasUrl(candidate)) {
    const homePage = await launchThirdpartyCas(cookieJar, candidate, referer);
    return inspectXgHomeForScore(cookieJar, homePage);
  }

  console.log("[xg-session] step=launch-xg-app host=" + sanitizeUrlForLog(candidate) + " pathname=" + safePathname(candidate));
  const page = await getPage(cookieJar, candidate, referer || PORTAL_ORIGIN + "/index").catch(err => {
    console.log("[xg-session] step=launch-xg-failed code=" + safeMessage(err));
    return null;
  });
  if (!page || !page.response) return null;

  console.log("[xg-session] step=launch-xg-result status=" + page.response.status +
    " finalHost=" + sanitizeUrlForLog(page.finalUrl) +
    " finalPathname=" + safePathname(page.finalUrl));

  if (isLoginTimeoutPage(page)) {
    console.log("[xg-session] step=launch-xg-timeout code=XG_LOGIN_REQUIRED");
    throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  }

  const redirectUrls = Array.isArray(page.urls) ? page.urls : [];
  const thirdpartySeen = redirectUrls.find(url => isThirdpartyCasUrl(url));
  if (thirdpartySeen) {
    console.log("[xg-session] step=find-thirdpartycas found=true");
    console.log("[xg-session] step=launch-thirdpartycas-result status=" + page.response.status +
      " finalHost=" + sanitizeUrlForLog(page.finalUrl));
    console.log("[xg-session] step=xg-cookie-established cookieCount=" + xgCookieCount(cookieJar));
    logChoosePersonFromRedirectTrace(page);
    const continued = await continueChoosePersonFlow(cookieJar, page, candidate);
    const homePage = await verifyXgHomeSession(cookieJar, continued && continued.finalUrl ? continued.finalUrl : candidate);
    return inspectXgHomeForScore(cookieJar, homePage);
  }

  if (hostOf(page.finalUrl) !== "xg.tyust.edu.cn") return null;
  return null;
}

async function inspectXgHomeForScore(cookieJar, page) {
  const html = String(page.response.data || "");
  const directScore = scoreUrlFromHtml(html, page.finalUrl) ||
    (String(page.finalUrl || "").includes(SCORE_PAGE_NAME) ? page.finalUrl : "");
  console.log("[xg-session] step=find-score-url found=" + Boolean(directScore) +
    " containsGridView1=" + html.includes("GridView1") +
    " containsAppStudentJudge=" + html.toLowerCase().includes("app_studentjudge"));
  if (directScore) {
    const verified = await verifyScoreUrl(cookieJar, directScore, page.finalUrl);
    if (verified) {
      console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
        " pathname=" + safePathname(verified.scoreUrl) +
        " cookieLength=" + verified.cookies.length);
      return verified;
    }
  }

  const discoveredAppLinks = await discoverStudentJudgeFromXgHome(cookieJar, page);
  if (isScoreQueryResult(discoveredAppLinks)) return discoveredAppLinks;
  for (const appUrl of discoveredAppLinks) {
    console.log("[xg-session] step=visit-studentjudge-app host=" + sanitizeUrlForLog(appUrl) + " pathname=" + safePathname(appUrl));
    const appPage = await getPage(cookieJar, appUrl, page.finalUrl).catch(err => {
      console.log("[xg-session] step=visit-studentjudge-app-failed code=" + safeMessage(err));
      return null;
    });
    if (!appPage || !appPage.response) continue;
    const appHtml = responseText(appPage.response);
    console.log("[xg-session] step=visit-studentjudge-app-result status=" + appPage.response.status +
      " host=" + sanitizeUrlForLog(appPage.finalUrl) +
      " pathname=" + safePathname(appPage.finalUrl) +
      " containsAppStudentJudge=" + hasStudentJudgeKeyword(appHtml) +
      " containsScorePage=" + appHtml.includes(SCORE_PAGE_NAME) +
      " containsGridView1=" + appHtml.includes("GridView1"));
    if (isLoginTimeoutPage(appPage)) {
      console.log("[xg-session] step=visit-studentjudge-timeout code=XG_LOGIN_REQUIRED");
      throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
    }
    const scoreUrl = scoreUrlFromHtml(appHtml, appPage.finalUrl) ||
      (String(appPage.finalUrl || "").includes(SCORE_PAGE_NAME) ? appPage.finalUrl : "") ||
      scoreUrlFromSessionPath(appPage.finalUrl);
    console.log("[xg-session] step=find-score-url found=" + Boolean(scoreUrl) +
      " host=" + (scoreUrl ? sanitizeUrlForLog(scoreUrl) : "none") +
      " pathname=" + (scoreUrl ? safePathname(scoreUrl) : "none"));
    if (!scoreUrl) continue;
    const verified = await verifyScoreUrl(cookieJar, scoreUrl, appPage.finalUrl);
    if (verified) {
      console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
        " pathname=" + safePathname(verified.scoreUrl) +
        " cookieLength=" + verified.cookies.length);
      return verified;
    }
  }

  const appLinks = appLinksFromHtml(html, page.finalUrl);
  console.log("[xg-session] step=find-app-studentjudge found=" + Boolean(appLinks.length) + " count=" + appLinks.length);
  const nestedCandidates = Array.from(new Set([
    ...appLinks,
    scoreUrlFromSessionPath(page.finalUrl)
  ].filter(Boolean)));

  for (const nested of nestedCandidates) {
    console.log("[xg-session] step=visit-app host=" + sanitizeUrlForLog(nested) + " pathname=" + safePathname(nested));
    const nestedPage = await getPage(cookieJar, nested, page.finalUrl).catch(err => {
      console.log("[xg-session] step=visit-app-failed code=" + safeMessage(err));
      return null;
    });
    if (!nestedPage || !nestedPage.response) continue;

    const nestedHtml = String(nestedPage.response.data || "");
    console.log("[xg-session] step=visit-app-result status=" + nestedPage.response.status +
      " host=" + sanitizeUrlForLog(nestedPage.finalUrl) +
      " pathname=" + safePathname(nestedPage.finalUrl) +
      " containsGridView1=" + nestedHtml.includes("GridView1") +
      " containsScorePage=" + nestedHtml.includes(SCORE_PAGE_NAME));

    if (isLoginTimeoutPage(nestedPage)) {
      console.log("[xg-session] step=visit-app-timeout code=XG_LOGIN_REQUIRED");
      throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
    }

    const scoreUrl = scoreUrlFromHtml(nestedHtml, nestedPage.finalUrl) ||
      (String(nestedPage.finalUrl || "").includes(SCORE_PAGE_NAME) ? nestedPage.finalUrl : "") ||
      scoreUrlFromSessionPath(nestedPage.finalUrl);
    console.log("[xg-session] step=find-score-url found=" + Boolean(scoreUrl) +
      " host=" + (scoreUrl ? sanitizeUrlForLog(scoreUrl) : "none") +
      " pathname=" + (scoreUrl ? safePathname(scoreUrl) : "none"));
    if (!scoreUrl) continue;

    const verified = await verifyScoreUrl(cookieJar, scoreUrl, nestedPage.finalUrl);
    if (verified) {
      console.log("[xg-session] step=score-page-ready host=" + sanitizeUrlForLog(verified.scoreUrl) +
        " pathname=" + safePathname(verified.scoreUrl) +
        " cookieLength=" + verified.cookies.length);
      return verified;
    }
  }

  return null;
}

async function discoverScoreSession(cookieJar) {
  console.log("[xg-session] step=discover-start");

  const portal = await getAndFollow(cookieJar, PORTAL_ORIGIN + "/index", PORTAL_ORIGIN + "/index").catch(() => null);
  const portalHtml = portal && portal.response ? String(portal.response.data || "") : "";
  const portalBase = portal ? portal.finalUrl : PORTAL_ORIGIN + "/index";

  console.log("[xg-session] step=enter-portal host=" + (portal ? sanitizeUrlForLog(portal.finalUrl) : "unknown") +
    " status=" + (portal && portal.response ? portal.response.status : "none") +
    " containsXg=" + portalHtml.includes("xg.tyust.edu.cn") +
    " containsXgManage=" + containsXgAppKeyword(portalHtml) +
    " containsStudentJudge=" + portalHtml.toLowerCase().includes("app_studentjudge"));

  const jsUrls = collectPortalJsUrls(portalHtml, portalBase);
  console.log("[portal-api] step=js-assets count=" + jsUrls.length);

  const suspiciousRefs = collectSuspiciousRefs(portalHtml, portalBase);
  console.log("[xg-session] step=portal-suspicious refs=" + suspiciousRefs.length);
  logSuspiciousRefs(suspiciousRefs);

  const jsTexts = await fetchPortalJsAssets(cookieJar, jsUrls, portalBase);
  const chunkUrls = Array.from(new Set(jsTexts.flatMap(text => collectChunkJsUrlsFromText(text, portalBase))));
  console.log("[portal-api] step=business-js-assets count=" + chunkUrls.length);
  const businessJsTexts = await fetchPortalJsAssets(cookieJar, chunkUrls, portalBase);
  jsTexts.push(...businessJsTexts);

  const baseUrlHints = Array.from(new Set(jsTexts.flatMap(text => extractBaseUrlHints(text, portalBase))));
  console.log("[portal-api] step=base-url-hints count=" + baseUrlHints.length);
  baseUrlHints.slice(0, 10).forEach(url => {
    console.log("[portal-api] baseURL host=" + sanitizeUrlForLog(url) + " pathname=" + safePathname(url));
  });

  const apiCandidates = Array.from(new Set(jsTexts.flatMap(text => extractPortalApiCandidates(text, portalBase))));
  logPortalApiCandidates(apiCandidates);
  const ssoAnalysis = analyzePortalSsoCall(jsTexts);
  const clickAnalysis = analyzePortalClickFunction(jsTexts);
  const oauthCode = await ensurePortalApiSession(cookieJar, portalBase);

  const xgApp = await discoverXgAppFromPortalApis(cookieJar, apiCandidates, portalBase);
  const directLaunch = await launchXgAppByPortalClick(cookieJar, xgApp, clickAnalysis, portalBase);
  if (directLaunch && directLaunch.homePage) {
    const verifiedFromHome = await inspectXgHomeForScore(cookieJar, directLaunch.homePage);
    if (verifiedFromHome) return verifiedFromHome;
  }
  if (directLaunch && directLaunch.xgAuthReached && !directLaunch.xgSessionEstablished) {
    console.log("[xg-session] step=failed code=" + (directLaunch.errorCode || "XG_LOGIN_REQUIRED"));
    throw makeError(directLaunch.errorCode || "XG_LOGIN_REQUIRED", "XG session was not established");
  }
  if (directLaunch && directLaunch.errorCode === "XG_SSO_PARAMETER_MISMATCH") {
    console.log("[xg-session] step=failed code=XG_SSO_PARAMETER_MISMATCH");
    throw makeError("XG_SSO_PARAMETER_MISMATCH", "XG direct launch did not start the XG app");
  }
  const appTargets = (directLaunch && directLaunch.selectedUrl ? [directLaunch.selectedUrl] : []).concat(xgApp && xgApp.targetUrls ? xgApp.targetUrls : []);
  const discoveredTexts = [portalHtml].concat(jsTexts);

  for (const ref of suspiciousRefs.slice(0, 20)) {
    if (hostOf(ref) && hostOf(ref) !== PORTAL_HOST) continue;
    if (isLikelyCss(ref)) continue;
    console.log("[xg-session] step=probe-portal-ref host=" + sanitizeUrlForLog(ref) + " pathname=" + safePathname(ref));
    const refPage = await getPage(cookieJar, ref, portalBase).catch(err => {
      console.log("[xg-session] step=probe-portal-ref-failed code=" + safeMessage(err));
      return null;
    });
    if (!refPage || !refPage.response) continue;
    const refHtml = responseText(refPage.response);
    console.log("[xg-session] step=probe-portal-ref-result status=" + refPage.response.status +
      " host=" + sanitizeUrlForLog(refPage.finalUrl) +
      " containsXg=" + refHtml.includes("xg.tyust.edu.cn") +
      " containsXgManage=" + containsXgAppKeyword(refHtml) +
      " containsStudentJudge=" + refHtml.toLowerCase().includes("app_studentjudge"));
    discoveredTexts.push(refHtml);
  }

  const nonPortalHtmlTexts = discoveredTexts.slice(1);
  const thirdpartyCasLinks = Array.from(new Set(
    appTargets
      .concat(nonPortalHtmlTexts.flatMap(text => thirdpartyCasUrlsFromText(text, portalBase)))
      .filter(url => isThirdpartyCasUrl(url))
  ));
  console.log("[xg-session] step=find-thirdpartycas found=" + Boolean(thirdpartyCasLinks.length) +
    " count=" + thirdpartyCasLinks.length);

  const portalLinks = Array.from(new Set(
    thirdpartyCasLinks
      .concat(appTargets)
      .concat(
        nonPortalHtmlTexts.flatMap(text => xgUrlsFromText(text, portalBase))
          .concat(appLinksFromHtml(portalHtml, portalBase))
          .filter(url => sanitizeUrlForLog(url) === "xg.tyust.edu.cn")
      )
  ));
  console.log("[xg-session] step=find-xg-entry found=" + Boolean(portalLinks.length) + " count=" + portalLinks.length);

  if (!portalLinks.length) {
    console.log("[xg-session] step=failed code=XG_LAUNCH_URL_NOT_FOUND");
    throw makeError("XG_LAUNCH_URL_NOT_FOUND", "XG thirdpartycas launch url was not found");
  }

  for (const candidate of portalLinks) {
    const verified = await inspectXgCandidate(cookieJar, candidate, portalBase);
    if (verified) return verified;
  }

  const code = thirdpartyCasLinks.length ? "XG_SCORE_URL_NOT_FOUND" : "XG_LAUNCH_URL_NOT_FOUND";
  console.log("[xg-session] step=find-score-url found=false code=" + code);
  throw makeError(code, code === "XG_LAUNCH_URL_NOT_FOUND" ? "XG thirdpartycas launch url was not found" : "Unable to find xg score page");
}

async function discoverXgLaunchForDebug(cookieJar) {
  const portal = await getAndFollow(cookieJar, PORTAL_ORIGIN + "/index", PORTAL_ORIGIN + "/index").catch(() => null);
  const portalHtml = portal && portal.response ? String(portal.response.data || "") : "";
  const portalBase = portal ? portal.finalUrl : PORTAL_ORIGIN + "/index";

  const jsUrls = collectPortalJsUrls(portalHtml, portalBase);
  const jsTexts = await fetchPortalJsAssets(cookieJar, jsUrls, portalBase);
  const chunkUrls = Array.from(new Set(jsTexts.flatMap(text => collectChunkJsUrlsFromText(text, portalBase))));
  const businessJsTexts = await fetchPortalJsAssets(cookieJar, chunkUrls, portalBase);
  jsTexts.push(...businessJsTexts);

  const apiCandidates = Array.from(new Set(jsTexts.flatMap(text => extractPortalApiCandidates(text, portalBase))));
  logPortalApiCandidates(apiCandidates);
  const ssoAnalysis = analyzePortalSsoCall(jsTexts);
  const clickAnalysis = analyzePortalClickFunction(jsTexts);
  const oauthCode = await ensurePortalApiSession(cookieJar, portalBase);
  const xgApp = await discoverXgAppFromPortalApis(cookieJar, apiCandidates, portalBase);
  const directLaunch = await launchXgAppByPortalClick(cookieJar, xgApp, clickAnalysis, portalBase);
  const thirdpartyCasLinks = Array.from(new Set(
    (directLaunch && directLaunch.selectedUrl ? [directLaunch.selectedUrl] : [])
      .concat(xgApp && xgApp.targetUrls ? xgApp.targetUrls : [])
      .concat(jsTexts.flatMap(text => thirdpartyCasUrlsFromText(text, portalBase)))
      .filter(url => isThirdpartyCasUrl(url))
  ));

  return {
    xgAppFound: Boolean(xgApp),
    redirectFunctionFound: Boolean(directLaunch && directLaunch.redirectFunctionFound),
    selectedBranch: directLaunch && directLaunch.selectedBranch ? directLaunch.selectedBranch : "unknown",
    selectedUrlSource: directLaunch && directLaunch.selectedUrlSource ? directLaunch.selectedUrlSource : "none",
    selectedHost: directLaunch && directLaunch.selectedHost ? directLaunch.selectedHost : "unknown",
    selectedPathname: directLaunch && directLaunch.selectedPathname ? directLaunch.selectedPathname : "unknown",
    directXgLaunchStarted: Boolean(directLaunch && directLaunch.directXgLaunchStarted),
    ssoLaunchStarted: Boolean(directLaunch && directLaunch.ssoLaunchStarted),
    xgAuthReached: Boolean(directLaunch && directLaunch.xgAuthReached),
    xgSessionEstablished: Boolean(directLaunch && directLaunch.xgSessionEstablished),
    thirdpartycasFound: Boolean((directLaunch && directLaunch.thirdpartycasFound) || thirdpartyCasLinks.length),
    thirdpartycasReached: Boolean((directLaunch && directLaunch.thirdpartycasReached) || (directLaunch && directLaunch.thirdpartycasFound) || thirdpartyCasLinks.length),
    choosePersonReached: Boolean(directLaunch && directLaunch.choosePersonReached),
    personChooseAnalyzed: Boolean(directLaunch && directLaunch.personChooseAnalyzed),
    personSelected: Boolean(directLaunch && directLaunch.personSelected),
    xgHomeReached: Boolean(directLaunch && directLaunch.xgHomeReached),
    xgHomeApiValid: Boolean(directLaunch && directLaunch.xgHomeApiValid),
    failedHop: directLaunch && directLaunch.failedHop ? directLaunch.failedHop : 0,
    finalHost: directLaunch && directLaunch.finalHost ? directLaunch.finalHost : sanitizeUrlForLog(directLaunch && directLaunch.finalUrl),
    finalPathname: directLaunch && directLaunch.finalPathname ? directLaunch.finalPathname : safePathname(directLaunch && directLaunch.finalUrl),
    authorizeRedirectHost: directLaunch && directLaunch.authorizeRedirectHost ? directLaunch.authorizeRedirectHost : "unknown",
    authorizeRedirectPathname: directLaunch && directLaunch.authorizeRedirectPathname ? directLaunch.authorizeRedirectPathname : "unknown",
    diagnosis: directLaunch && directLaunch.diagnosis ? directLaunch.diagnosis : "",
    oauthLoopDetected: Boolean(directLaunch && directLaunch.oauthLoopDetected),
    errorCode: directLaunch && directLaunch.errorCode ? directLaunch.errorCode : "",
    ssoMethod: ssoAnalysis.method,
    ssoParamKeys: ssoAnalysis.paramKeys || [],
    appFieldKeys: xgApp && xgApp.record && xgApp.record.raw ? Object.keys(xgApp.record.raw) : [],
    homePage: directLaunch && directLaunch.homePage ? directLaunch.homePage : null
  };
}

function emptyStudentJudgeDebugResult(errorCode) {
  return {
    studentJudgeRecordFound: false,
    jumpUrlSuccess: false,
    omniselectorReached: false,
    dynamicSessionPathReached: false,
    studentJudgeSessionEstablished: false,
    applicationPageValid: false,
    omniselectorRequestCount: 0,
    repeatedPConsumed: false,
    first500Hop: 0,
    first500Pathname: "",
    first500In: "none",
    cookieCounts: [],
    applicationErrorDiagnostic: null,
    scoreEntryFound: false,
    scorePageReached: false,
    scorePageValid: false,
    containsGridView1: false,
    xgGradesParsed: false,
    xgGradeCount: 0,
    errorCode: errorCode || ""
  };
}

function finalizeStudentJudgeDebugResult(result) {
  if (!result.errorCode) {
    if (!result.studentJudgeRecordFound) result.errorCode = "STUDENT_JUDGE_RECORD_NOT_FOUND";
    else if (!result.jumpUrlSuccess) result.errorCode = "STUDENT_JUDGE_JUMP_URL_NOT_FOUND";
    else if (!result.omniselectorReached) result.errorCode = "STUDENT_JUDGE_OMNISELECTOR_NOT_REACHED";
    else if (!result.dynamicSessionPathReached) result.errorCode = "STUDENT_JUDGE_DYNAMIC_APPLICATION_NOT_REACHED";
    else if (!result.applicationPageValid) result.errorCode = "STUDENT_JUDGE_APPLICATION_INVALID";
    else if (!result.studentJudgeSessionEstablished) result.errorCode = "STUDENT_JUDGE_SESSION_NOT_ESTABLISHED";
    else if (!result.scoreEntryFound) result.errorCode = "XG_SCORE_ENTRY_NOT_FOUND";
    else if (!result.scorePageReached) result.errorCode = "XG_SCORE_PAGE_NOT_REACHED";
    else if (!result.scorePageValid) result.errorCode = "XG_SCORE_PAGE_INVALID";
    else if (!result.xgGradesParsed) result.errorCode = "XG_SCORE_PARSE_FAILED";
    else result.errorCode = "none";
  }
  return result;
}

function printStudentJudgeDebugResult(result) {
  console.log("studentJudgeRecordFound=" + Boolean(result.studentJudgeRecordFound));
  console.log("jumpUrlSuccess=" + Boolean(result.jumpUrlSuccess));
  console.log("omniselectorReached=" + Boolean(result.omniselectorReached));
  console.log("dynamicSessionPathReached=" + Boolean(result.dynamicSessionPathReached));
  console.log("studentJudgeSessionEstablished=" + Boolean(result.studentJudgeSessionEstablished));
  console.log("applicationPageValid=" + Boolean(result.applicationPageValid));
  console.log("omniselectorRequestCount=" + (result.omniselectorRequestCount || 0));
  console.log("repeatedPConsumed=" + Boolean(result.repeatedPConsumed));
  console.log("first500Hop=" + (result.first500Hop || 0));
  console.log("first500In=" + (result.first500In || "none"));
  console.log("first500Pathname=" + (result.first500Pathname || "none"));
  if (result.cookieCounts && result.cookieCounts.length) {
    console.log("cookieCounts=" + result.cookieCounts.map(item => "hop" + item.hop + ":" + item.before + "->" + item.after).join(","));
  } else {
    console.log("cookieCounts=none");
  }
  if (result.applicationErrorDiagnostic) {
    const diagnostic = result.applicationErrorDiagnostic;
    console.log("applicationErrorStatus=" + diagnostic.status);
    console.log("applicationErrorContentType=" + diagnostic.contentType);
    console.log("applicationErrorTitle=" + diagnostic.title);
    console.log("applicationErrorBodyLength=" + diagnostic.bodyLength);
    console.log("applicationErrorContainsLoginTimeout=" + diagnostic.containsLoginTimeout);
    console.log("applicationErrorContainsServerError=" + diagnostic.containsServerError);
    console.log("applicationErrorContainsRuntimeError=" + diagnostic.containsRuntimeError);
    console.log("applicationErrorContainsException=" + diagnostic.containsException);
    console.log("applicationErrorContainsSessionError=" + diagnostic.containsSessionError);
  }
  console.log("scoreEntryFound=" + Boolean(result.scoreEntryFound));
  console.log("scorePageReached=" + Boolean(result.scorePageReached));
  console.log("scorePageValid=" + Boolean(result.scorePageValid));
  console.log("containsGridView1=" + Boolean(result.containsGridView1));
  console.log("xgGradesParsed=" + Boolean(result.xgGradesParsed));
  console.log("xgGradeCount=" + (result.xgGradeCount || 0));
  console.log("errorCode=" + (result.errorCode || "none"));
}

async function debugStudentJudgeLaunch(cookieJar, homePage) {
  const result = emptyStudentJudgeDebugResult();
  if (!cookieJar || !homePage || !homePage.response) {
    return finalizeStudentJudgeDebugResult(emptyStudentJudgeDebugResult("XG_SESSION_REQUIRED"));
  }
  try {
    const discovered = await discoverStudentJudgeFromXgHome(cookieJar, homePage, result);
    if (isScoreQueryResult(discovered)) result.errorCode = "";
    return finalizeStudentJudgeDebugResult(result);
  } catch (err) {
    result.errorCode = err && err.code ? err.code : "STUDENT_JUDGE_LAUNCH_FAILED";
    return finalizeStudentJudgeDebugResult(result);
  }
}

async function debugXgLaunch(userId) {
  const credentials = credentialStore.getJwxtCredentials(userId);
  if (!credentials || !credentials.studentId || !credentials.password) {
    throw makeError("CAMPUS_LOGIN_REQUIRED", "Campus account is not bound");
  }
  const portal = await httpPortalLogin(credentials.studentId, credentials.password);
  console.log("portalLogin=true");
  const result = await discoverXgLaunchForDebug(portal.cookieJar);
  console.log("xgAppFound=" + result.xgAppFound);
  console.log("redirectFunctionFound=" + result.redirectFunctionFound);
  console.log("selectedBranch=" + (result.selectedBranch || "unknown"));
  console.log("selectedUrlSource=" + (result.selectedUrlSource || "none"));
  console.log("selectedHost=" + (result.selectedHost || "unknown"));
  console.log("selectedPathname=" + (result.selectedPathname || "unknown"));
  console.log("directXgLaunchStarted=" + result.directXgLaunchStarted);
  console.log("ssoLaunchStarted=" + result.ssoLaunchStarted);
  console.log("authorizeRedirectHost=" + (result.authorizeRedirectHost || "unknown"));
  console.log("authorizeRedirectPathname=" + (result.authorizeRedirectPathname || "unknown"));
  console.log("diagnosis=" + (result.diagnosis || "none"));
  console.log("oauthLoopDetected=" + Boolean(result.oauthLoopDetected));
  console.log("xgAuthReached=" + result.xgAuthReached);
  console.log("thirdpartycasReached=" + result.thirdpartycasReached);
  console.log("choosePersonReached=" + result.choosePersonReached);
  console.log("personChooseAnalyzed=" + result.personChooseAnalyzed);
  console.log("personSelected=" + result.personSelected);
  console.log("xgHomeReached=" + result.xgHomeReached);
  console.log("xgHomeApiValid=" + result.xgHomeApiValid);
  console.log("xgSessionEstablished=" + result.xgSessionEstablished);
  console.log("thirdpartycasFound=" + result.thirdpartycasFound);
  if (!result.xgSessionEstablished) {
    console.log("failedHop=" + (result.failedHop || 0));
    console.log("finalHost=" + (result.finalHost || "unknown"));
    console.log("finalPathname=" + (result.finalPathname || "unknown"));
    console.log("errorCode=" + (result.errorCode || "XG_LAUNCH_URL_NOT_FOUND"));
  }
  const studentJudgeResult = result.xgSessionEstablished
    ? await debugStudentJudgeLaunch(portal.cookieJar, result.homePage)
    : finalizeStudentJudgeDebugResult(emptyStudentJudgeDebugResult(result.errorCode || "XG_SESSION_REQUIRED"));
  printStudentJudgeDebugResult(studentJudgeResult);
  Object.assign(result, studentJudgeResult);
  console.log("ssoMethod=" + result.ssoMethod);
  console.log("ssoParamKeys=" + (result.ssoParamKeys.length ? result.ssoParamKeys.join(",") : "none"));
  console.log("appFieldKeys=" + result.appFieldKeys.slice(0, 40).join(","));
  return result;
}

async function ensureXgScoreSession(userId, activeStorage) {
  console.log("[xg-session] step=ensure-start userScope=" + (userId ? "user" : "legacy"));
  try {
    const cached = await validateCachedSession(activeStorage);
    if (cached) {
      console.log("[xg-session] step=ensure-success source=cache host=" + sanitizeUrlForLog(cached.scoreUrl) + " pathname=" + safePathname(cached.scoreUrl));
      return cached;
    }
  } catch (err) {
    console.log("[xg-session] step=cache-invalid code=" + ((err && err.code) || "XG_SESSION_INVALID"));
  }

  const credentials = credentialStore.getJwxtCredentials(userId);
  console.log("[xg-session] step=campus-credentials exists=" + Boolean(credentials && credentials.studentId && credentials.password));
  if (!credentials || !credentials.studentId || !credentials.password) {
    console.log("[xg-session] step=failed code=CAMPUS_LOGIN_REQUIRED");
    throw makeError("CAMPUS_LOGIN_REQUIRED", "Campus account is not bound");
  }

  let portal;
  try {
    console.log("[xg-session] step=portal-login-start");
    portal = await httpPortalLogin(credentials.studentId, credentials.password);
    console.log("[xg-session] step=portal-login-success host=" + sanitizeUrlForLog(portal.finalUrl));
  } catch (err) {
    const code = err && err.code ? err.code : "CAMPUS_LOGIN_REQUIRED";
    console.log("[xg-session] step=portal-login-failed code=" + code);
    throw makeError(code === "JWXT_CAPTCHA_REQUIRED" ? "CAMPUS_LOGIN_REQUIRED" : code, err && err.message ? err.message : "Campus login required");
  }

  const session = await discoverScoreSession(portal.cookieJar);
  if (!session.scoreUrl || !session.cookies) {
    console.log("[xg-session] step=failed code=XG_SESSION_MISSING");
    throw makeError("XG_LOGIN_REQUIRED", "Unable to build xg score session");
  }

  const grades = Array.isArray(session.grades)
    ? session.grades
    : await queryXgScores({
      scoreUrl: session.scoreUrl,
      cookies: session.cookies
    });

  if (activeStorage && typeof activeStorage.saveXgSession === "function") {
    activeStorage.saveXgSession(session.scoreUrl, session.cookies);
  }
  console.log("[xg-session] step=ensure-success source=login host=" + sanitizeUrlForLog(session.scoreUrl) +
    " pathname=" + safePathname(session.scoreUrl) +
    " cookieLength=" + session.cookies.length);
  return {
    scoreUrl: session.scoreUrl,
    cookies: session.cookies,
    grades,
    fromCache: false
  };
}

module.exports = {
  ensureXgScoreSession,
  sanitizeUrlForLog,
  debugXgLaunch,
  debugStudentJudgeLaunch
};
