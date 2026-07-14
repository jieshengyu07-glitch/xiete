const axios = require("axios");
const cheerio = require("cheerio");
const { parseXgStudentScores } = require("./xgScoreParser");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function makeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function safePathname(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.pathname.replace(/\/\(S\([^/]+\)\)\//g, "/(S(**redacted**))/");
  } catch (err) {
    return "unknown";
  }
}

function safeHost(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch (err) {
    return "unknown";
  }
}

function cookieHeader(cookies) {
  if (!cookies) return "";
  if (typeof cookies === "string") return cookies.trim();
  if (Array.isArray(cookies)) {
    return cookies
      .filter(item => item && item.name && item.value)
      .map(item => item.name + "=" + item.value)
      .join("; ");
  }
  return "";
}

function validateScoreUrl(scoreUrl) {
  if (!scoreUrl) return false;
  try {
    const parsed = new URL(String(scoreUrl));
    return parsed.hostname === "xg.tyust.edu.cn" &&
      parsed.pathname.includes("StuStudentScore.aspx");
  } catch (err) {
    return false;
  }
}

function looksLikeLoginPage(html) {
  const text = String(html || "").toLowerCase();
  return text.includes("login") ||
    text.includes("统一身份认证") ||
    text.includes("用户登录") ||
    text.includes("password") ||
    text.includes("cas/login");
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
    text.includes("登录超时") ||
    text.includes("login timeout") ||
    text.includes("sso1.tyust.edu.cn/logout");
}

function hiddenFields(html) {
  const $ = cheerio.load(html || "");
  const fieldNames = [
    "__EVENTTARGET",
    "__EVENTARGUMENT",
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__VIEWSTATEENCRYPTED",
    "__EVENTVALIDATION"
  ];
  const fields = {};
  fieldNames.forEach(name => {
    fields[name] = $("input[name='" + name + "']").attr("value") || "";
  });
  return fields;
}

function normalizeTerm(term) {
  const text = String(term || "").trim();
  const match = text.match(/^(\d{4})-(\d{4})-(\d)$/);
  if (!match) return text;
  return match[1] + "-" + match[2] + "学年第" + match[3] + "学期";
}

async function queryXgScores(options) {
  const opts = options || {};
  const scoreUrl = String(opts.scoreUrl || "").trim();
  const cookies = cookieHeader(opts.cookies);
  console.log("[xg-query] step=start hasScoreUrl=" + Boolean(scoreUrl) + " hasCookies=" + Boolean(cookies) + " cookieLength=" + cookies.length);

  if (!scoreUrl || !cookies) {
    console.log("[xg-query] step=failed code=XG_SESSION_MISSING");
    throw makeError("XG_SESSION_MISSING", "Missing xg scoreUrl or cookies");
  }
  if (!validateScoreUrl(scoreUrl)) {
    console.log("[xg-query] step=failed code=XG_SCORE_PAGE_INVALID host=" + safeHost(scoreUrl) + " pathname=" + safePathname(scoreUrl));
    throw makeError("XG_SCORE_PAGE_INVALID", "Invalid xg score page url");
  }
  if (isLoginTimeoutUrl(scoreUrl)) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-timeout-url");
    throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  }
  console.log("[xg-query] step=get-score-page host=" + safeHost(scoreUrl) + " pathname=" + safePathname(scoreUrl));

  const commonHeaders = {
    "User-Agent": USER_AGENT,
    "Cookie": cookies,
    "Referer": scoreUrl
  };

  const getResp = await axios.get(scoreUrl, {
    headers: commonHeaders,
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: status => status >= 200 && status < 400
  }).catch(err => {
    if (err.response && err.response.status >= 300 && err.response.status < 400) {
      console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED status=" + err.response.status);
      throw makeError("XG_LOGIN_REQUIRED", "XG session redirected to login");
    }
    console.log("[xg-query] step=failed code=" + String((err && (err.code || err.name)) || "REQUEST_FAILED").slice(0, 80));
    throw err;
  });

  let html = String(getResp.data || "");
  console.log("[xg-query] step=get-score-page-result status=" + getResp.status +
    " host=" + safeHost(scoreUrl) +
    " containsGridView1=" + html.includes("GridView1") +
    " containsViewState=" + html.includes("__VIEWSTATE"));
  if (isLoginTimeoutHtml(html)) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-timeout-page");
    throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  }
  if (getResp.status >= 300 && getResp.status < 400) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED status=" + getResp.status);
    throw makeError("XG_LOGIN_REQUIRED", "XG session redirected to login");
  }
  if (looksLikeLoginPage(html)) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-page");
    throw makeError("XG_LOGIN_REQUIRED", "XG session is not logged in");
  }
  if (!html.includes("StuStudentScore.aspx") && !html.includes("GridView1") && !html.includes("__VIEWSTATE")) {
    console.log("[xg-query] step=failed code=XG_SCORE_PAGE_INVALID containsGridView1=false containsViewState=false");
    throw makeError("XG_SCORE_PAGE_INVALID", "Response is not the xg score page");
  }

  const shouldPost = opts.term !== undefined || opts.courseName !== undefined || opts.courseType !== undefined;
  if (shouldPost) {
    const fields = hiddenFields(html);
    console.log("[xg-query] step=post-search hasViewState=" + Boolean(fields.__VIEWSTATE) + " hasEventValidation=" + Boolean(fields.__EVENTVALIDATION));
    const form = new URLSearchParams({
      __EVENTTARGET: fields.__EVENTTARGET || "",
      __EVENTARGUMENT: fields.__EVENTARGUMENT || "",
      __VIEWSTATE: fields.__VIEWSTATE || "",
      __VIEWSTATEGENERATOR: fields.__VIEWSTATEGENERATOR || "",
      __VIEWSTATEENCRYPTED: fields.__VIEWSTATEENCRYPTED || "",
      __EVENTVALIDATION: fields.__EVENTVALIDATION || "",
      YearTime: normalizeTerm(opts.term),
      CourseName: String(opts.courseName || ""),
      CourseType: String(opts.courseType || ""),
      BtnSearch: "查询"
    });

    const postResp = await axios.post(scoreUrl, form.toString(), {
      headers: {
        ...commonHeaders,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    }).catch(err => {
      if (err.response && err.response.status >= 300 && err.response.status < 400) {
        console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED status=" + err.response.status);
        throw makeError("XG_LOGIN_REQUIRED", "XG session redirected to login");
      }
      console.log("[xg-query] step=failed code=" + String((err && (err.code || err.name)) || "REQUEST_FAILED").slice(0, 80));
      throw err;
    });

    html = String(postResp.data || "");
    console.log("[xg-query] step=post-search-result status=" + postResp.status +
      " containsGridView1=" + html.includes("GridView1") +
      " containsViewState=" + html.includes("__VIEWSTATE"));
    if (isLoginTimeoutHtml(html)) {
      console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-timeout-page");
      throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
    }
    if (postResp.status >= 300 && postResp.status < 400) {
      console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED status=" + postResp.status);
      throw makeError("XG_LOGIN_REQUIRED", "XG session redirected to login");
    }
    if (looksLikeLoginPage(html)) {
      console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-page");
      throw makeError("XG_LOGIN_REQUIRED", "XG session is not logged in");
    }
  }

  const scores = parseXgStudentScores(html);
  console.log("[xg-query] step=parse-complete count=" + scores.length);
  return scores;
}

module.exports = {
  queryXgScores,
  cookieHeader,
  normalizeTerm
};
