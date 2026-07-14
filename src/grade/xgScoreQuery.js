const axios = require("axios");
const cheerio = require("cheerio");
const { mergeGrades } = require("./gradeMerger");
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
    text.includes("缁熶竴韬唤璁よ瘉") ||
    text.includes("鐢ㄦ埛鐧诲綍") ||
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
    text.includes("鐧诲綍瓒呮椂") ||
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
  return match[1] + "-" + match[2] + "瀛﹀勾绗?" + match[3] + "瀛︽湡";
}

function gridRowCount(html) {
  const $ = cheerio.load(html || "");
  const rows = $("#GridView1 tr").length;
  return rows > 0 ? rows - 1 : 0;
}

function detectPagination(html) {
  const $ = cheerio.load(html || "");
  const text = $.text();
  const raw = String(html || "");
  const pageNumbers = [];
  const addPage = value => {
    const page = Number(value);
    if (Number.isFinite(page) && page > 0 && !pageNumbers.includes(page)) pageNumbers.push(page);
  };
  let match;
  const postbackPattern = /__doPostBack\(\s*['"]GridView1['"]\s*,\s*['"]Page\$(\d+)['"]\s*\)/ig;
  while ((match = postbackPattern.exec(raw))) addPage(match[1]);
  const genericPagePattern = /Page\$(\d+)/ig;
  while ((match = genericPagePattern.exec(raw))) addPage(match[1]);
  $("a[href], option[value], input[value]").each((_, el) => {
    const value = String($(el).attr("href") || $(el).attr("value") || "");
    const pageMatch = value.match(/Page\$(\d+)/i);
    if (pageMatch) addPage(pageMatch[1]);
  });
  pageNumbers.sort((a, b) => a - b);
  const currentPage = 1;
  const totalPages = pageNumbers.length ? Math.max(currentPage, ...pageNumbers) : currentPage;
  const combined = raw + "\n" + text;
  const hasNextPage = pageNumbers.some(page => page > currentPage);
  const hasPagination = pageNumbers.length > 0 ||
    /Page\$|__doPostBack|下一页|上一页|首页|末页|页次|总记录|Pager|pagination/i.test(combined);
  const yearValuePresent = Boolean($("[name='YearTime']").val() || $("[name='YearTime'] option:selected").val());
  const courseTypeValue = String($("[name='CourseType']").val() || $("[name='CourseType'] option:selected").val() || "");
  return {
    hasPagination,
    currentPage,
    totalPages,
    currentRows: gridRowCount(html),
    hasNextPage,
    nextPages: pageNumbers.filter(page => page > currentPage),
    yearValuePresent,
    courseTypeValue: courseTypeValue ? "present" : "none"
  };
}

function buildSearchForm(html) {
  const fields = hiddenFields(html);
  return new URLSearchParams({
    __EVENTTARGET: fields.__EVENTTARGET || "",
    __EVENTARGUMENT: fields.__EVENTARGUMENT || "",
    __VIEWSTATE: fields.__VIEWSTATE || "",
    __VIEWSTATEGENERATOR: fields.__VIEWSTATEGENERATOR || "",
    __VIEWSTATEENCRYPTED: fields.__VIEWSTATEENCRYPTED || "",
    __EVENTVALIDATION: fields.__EVENTVALIDATION || "",
    YearTime: "",
    CourseName: "",
    CourseType: "",
    BtnSearch: "查询"
  });
}

function buildPageForm(html, page) {
  const fields = hiddenFields(html);
  return new URLSearchParams({
    __EVENTTARGET: "GridView1",
    __EVENTARGUMENT: "Page$" + page,
    __VIEWSTATE: fields.__VIEWSTATE || "",
    __VIEWSTATEGENERATOR: fields.__VIEWSTATEGENERATOR || "",
    __VIEWSTATEENCRYPTED: fields.__VIEWSTATEENCRYPTED || "",
    __EVENTVALIDATION: fields.__EVENTVALIDATION || ""
  });
}

function assertScorePageHtml(html, status) {
  if (isLoginTimeoutHtml(html)) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-timeout-page");
    throw makeError("XG_LOGIN_REQUIRED", "XG login timeout");
  }
  if (status >= 300 && status < 400) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED status=" + status);
    throw makeError("XG_LOGIN_REQUIRED", "XG session redirected to login");
  }
  if (looksLikeLoginPage(html)) {
    console.log("[xg-query] step=failed code=XG_LOGIN_REQUIRED reason=login-page");
    throw makeError("XG_LOGIN_REQUIRED", "XG session is not logged in");
  }
}

async function postScoreForm(scoreUrl, form, commonHeaders) {
  return axios.post(scoreUrl, form.toString(), {
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
  assertScorePageHtml(html, getResp.status);
  if (!html.includes("StuStudentScore.aspx") && !html.includes("GridView1") && !html.includes("__VIEWSTATE")) {
    console.log("[xg-query] step=failed code=XG_SCORE_PAGE_INVALID containsGridView1=false containsViewState=false");
    throw makeError("XG_SCORE_PAGE_INVALID", "Response is not the xg score page");
  }

  const fields = hiddenFields(html);
  console.log("[xg-query] step=reset-filters yearTimeCleared=true courseNameCleared=true courseTypeCleared=true");
  console.log("[xg-query] step=post-search hasViewState=" + Boolean(fields.__VIEWSTATE) + " hasEventValidation=" + Boolean(fields.__EVENTVALIDATION));
  const postResp = await postScoreForm(scoreUrl, buildSearchForm(html), commonHeaders);
  html = String(postResp.data || "");
  console.log("[xg-query] step=post-search-result status=" + postResp.status +
    " containsGridView1=" + html.includes("GridView1") +
    " containsViewState=" + html.includes("__VIEWSTATE"));
  assertScorePageHtml(html, postResp.status);

  const pagination = detectPagination(html);
  console.log("[xg-query] step=pagination-detect" +
    " hasPagination=" + pagination.hasPagination +
    " currentPage=" + pagination.currentPage +
    " totalPages=" + pagination.totalPages +
    " currentRows=" + pagination.currentRows +
    " hasNextPage=" + pagination.hasNextPage);

  const pageOneScores = parseXgStudentScores(html);
  console.log("[xg-query] step=page-result page=1 rows=" + pageOneScores.length);
  let allScores = pageOneScores.slice();
  let currentHtml = html;
  let pagesVisited = 1;
  for (const page of pagination.nextPages) {
    const pageResp = await postScoreForm(scoreUrl, buildPageForm(currentHtml, page), commonHeaders);
    currentHtml = String(pageResp.data || "");
    assertScorePageHtml(currentHtml, pageResp.status);
    const pageScores = parseXgStudentScores(currentHtml);
    console.log("[xg-query] step=page-result page=" + page + " rows=" + pageScores.length);
    allScores = allScores.concat(pageScores);
    pagesVisited += 1;
  }

  const merged = mergeGrades([], allScores);
  console.log("[xg-query] step=all-pages-complete pages=" + pagesVisited +
    " rawRows=" + allScores.length +
    " finalRows=" + merged.grades.length);
  if (!pagination.hasPagination || !pagination.nextPages.length) {
    console.log("[xg-query] step=filter-inspect" +
      " yearValuePresent=" + pagination.yearValuePresent +
      " courseTypeValue=" + pagination.courseTypeValue +
      " recordCount=" + pageOneScores.length);
  }
  console.log("[xg-query] step=parse-complete count=" + merged.grades.length);
  return merged.grades;
}

module.exports = {
  queryXgScores,
  cookieHeader,
  normalizeTerm
};
