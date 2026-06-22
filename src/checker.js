const fs = require("fs");
const path = require("path");
const axios = require("axios");
const storage = require("./db/storage");
const { httpJwxtLogin } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");

const COOKIE_FILE = path.join(__dirname, "..", "data", "cookies.json");

// Ensure data dir exists
const DATA_DIR = path.dirname(COOKIE_FILE);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// On startup: if COOKIES_JSON env var is set and file doesnt exist, write it
if (process.env.COOKIES_JSON) {
  try {
    const parsed = JSON.parse(process.env.COOKIES_JSON);
    if (Array.isArray(parsed) && parsed.length > 0 && !fs.existsSync(COOKIE_FILE)) {
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(parsed, null, 2));
      console.log("[checker] Init cookies from COOKIES_JSON env var (" + parsed.length + " entries)");
    }
  } catch (e) {
    console.error("[checker] Failed to parse COOKIES_JSON env var:", e.message);
  }
}

function loadCookies() {
  // Try file first
  if (fs.existsSync(COOKIE_FILE)) {
    try { return JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8")); } catch { console.error("[checker] Failed to parse cookies.json"); }
  }
  // Fallback to env var at runtime
  if (process.env.COOKIES_JSON) {
    try { return JSON.parse(process.env.COOKIES_JSON); } catch {}
  }
  return null;
}

function isJwglxtPath(cookiePath) {
  return cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
}

function selectJwxtGradeCookies(cookies) {
  var list = Array.isArray(cookies) ? cookies : [];
  var route = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/";
  });
  var jsession = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path);
  });
  var rememberMe = list.find(function(c) {
    return String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path);
  });
  return [route, jsession, rememberMe].filter(Boolean);
}

function buildCookieHeader(cookies, domainPattern) {
  if (domainPattern === "newjwc.tyust.edu.cn") {
    var selected = selectJwxtGradeCookies(cookies);
    if (selected.some(function(c) { return c.name === "JSESSIONID"; })) {
      return selected.map(function(c) { return c.name + "=" + c.value; }).join("; ");
    }
  }
  return cookies.filter(c => String(c.domain || "").includes(domainPattern)).map(c => c.name + "=" + c.value).join("; ");
}

function writeCookies(cookiesData) {
  const dir = path.dirname(COOKIE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookiesData, null, 2));
}


const ALL_TERMS = [
  {xnm:"2023",xqm:"3"},{xnm:"2023",xqm:"12"},
  {xnm:"2024",xqm:"3"},{xnm:"2024",xqm:"12"},
  {xnm:"2025",xqm:"3"},{xnm:"2025",xqm:"12"},
];

function fail(cookieStatus, message, extra) {
  var result = Object.assign({
    success: false,
    error: cookieStatus,
    cookieStatus: cookieStatus,
    message: message || cookieStatus
  }, extra || {});
  console.log("[checker] " + cookieStatus + ": " + result.message);
  return result;
}

function isLoginPage(data) {
  if (typeof data !== "string") return false;
  return data.includes("login_slogin.html") ||
    data.includes("/jwglxt/xtgl/login") ||
    data.includes("用户登录") ||
    data.includes("用户名");
}

function isEmptyResponse(data) {
  return data === null || data === undefined || data === "";
}

function classifyResponse(resp) {
  if (!resp) return { status: "jwxt_unavailable", message: "No response from JWXT" };
  if (resp.status === 901 || resp.status === 403 || resp.status === 302) {
    return { status: "cookie_expired", message: "JWXT returned HTTP " + resp.status };
  }
  if (resp.status >= 500) {
    return { status: "jwxt_unavailable", message: "JWXT returned HTTP " + resp.status };
  }
  if (isEmptyResponse(resp.data)) {
    return { status: "jwxt_unavailable", message: "JWXT returned empty response" };
  }
  if (isLoginPage(resp.data)) {
    return { status: "cookie_expired", message: "JWXT returned login page" };
  }
  if (resp.status !== 200) {
    return { status: "query_error", message: "JWXT returned HTTP " + resp.status };
  }
  return null;
}

function attachTermToGrade(grade, term) {
  var item = grade || {};
  item.xnm = term.xnm || item.xnm || item.XNM;
  item.xqm = term.xqm || item.xqm || item.XQM;
  item.XNM = item.xnm;
  item.XQM = item.xqm;
  return item;
}

function isCookieExpiredResult(result) {
  return result && (result.cookieStatus === "cookie_expired" || result.error === "cookie_expired");
}

async function refreshCookiesFromEnv() {
  const credentials = credentialStore.getJwxtCredentials();
  if (!credentials) {
    console.log("[checker] Cookie 失效，但未配置 JWXT_STUDENT_ID/JWXT_PASSWORD，保持原返回");
    return null;
  }

  console.log("[checker] 检测到 Cookie 失效，尝试自动刷新");
  try {
    const login = await httpJwxtLogin(credentials.studentId, credentials.password);
    const selected = selectJwxtGradeCookies(login.cookies);
    const hasRoute = selected.some(function(c) { return c.name === "route"; });
    const hasJSession = selected.some(function(c) { return c.name === "JSESSIONID"; });
    const hasRememberMe = selected.some(function(c) { return c.name === "rememberMe"; });
    if (!hasRoute || !hasJSession || !hasRememberMe) {
      console.log("[checker] 自动刷新失败：未获取完整 route/JSESSIONID/rememberMe Cookie");
      return null;
    }
    writeCookies(selected);
    console.log("[checker] 自动刷新成功，已更新 cookies.json（未打印 Cookie 值）");
    return selected;
  } catch (err) {
    console.log("[checker] 自动刷新失败：" + err.message);
    return null;
  }
}

async function executeCheck(cookies) {
  if (!cookies) return fail("login_required", "Run: npm run login or POST /upload-cookies");
  const cs = buildCookieHeader(cookies, "newjwc.tyust.edu.cn");
  if (!cs) return fail("login_required", "Missing JWXT session cookie. Upload via POST /upload-cookies");
  try {
    var initResp = await axios.get("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",{headers:{"Cookie":cs},maxRedirects:0,validateStatus:s=>true,timeout:10000}).catch(function(err){ return { status: 0, data: "", _error: err.message }; });
    var initClass = initResp._error ? { status: "jwxt_unavailable", message: initResp._error } : classifyResponse(initResp);
    if (initClass) return fail(initClass.status, initClass.message, { httpStatus: initResp.status });
    var allGrades=[];
    for(var i=0;i<ALL_TERMS.length;i++){
      var t=ALL_TERMS[i];
      console.log("[checker] querying grades xnm=" + t.xnm + " xqm=" + t.xqm);
      try{
        var resp=await axios.post(
          "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query",
          new URLSearchParams({xnm:t.xnm,xqm:t.xqm,page:"1",rows:"50"}).toString(),
          {headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":cs,"Referer":"https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default"},maxRedirects:0,validateStatus:function(s){return true;},timeout:30000}
        );
        var respClass = classifyResponse(resp);
        if(respClass) return fail(respClass.status, respClass.message, { httpStatus: resp.status, term: t });
        var data=resp.data;
        var grades=[];
        if(Array.isArray(data))grades=data;
        else if(data.items)grades=data.items;
        else if(data.rows)grades=data.rows;
        else return fail("query_error", "Unexpected grade response format", { term: t });
        console.log("[checker] term " + t.xnm + "-" + t.xqm + " count=" + grades.length);
        for(var g=0;g<grades.length;g++)allGrades.push(attachTermToGrade(grades[g], t));
      }catch(e){
        return fail("query_error", e.message, { term: t });
      }
    }
    if(!allGrades.length)return{success:true,cookieStatus:"cookie_valid",gradesCount:0,added:[],changed:[],grades:[]};
    var diff=storage.diffGrades(allGrades);
    storage.mergeGrades(allGrades);
    if(diff.added.length||diff.changed.length)storage.addGradeChange({type:"update"});
    storage.updateLastRun();
    return{success:true,cookieStatus:"cookie_valid",gradesCount:allGrades.length,added:diff.added.map(function(g){return{kcmc:g.KCMC||g.kcmc,cj:g.CJ||g.cj};}),changed:diff.changed,grades:[]};
  }catch(err){
    return fail("query_error", err.message);
  }
}

async function runCycle() {
  const cookies = loadCookies();
  const first = await executeCheck(cookies);
  if (!isCookieExpiredResult(first)) return first;

  const refreshedCookies = await refreshCookiesFromEnv();
  if (!refreshedCookies) return first;

  const retry = await executeCheck(refreshedCookies);
  if (retry.success) {
    retry.cookieStatus = "cookie_valid";
    return retry;
  }
  if (isCookieExpiredResult(retry)) return fail("cookie_expired", retry.message || "JWXT cookie refresh retry failed");
  return retry;
}

module.exports = { runCycle, loadCookies, writeCookies };
