const fs = require("fs");
const path = require("path");
const axios = require("axios");
const storage = require("./db/storage");

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

function buildCookieHeader(cookies, domainPattern) {
  return cookies.filter(c => c.domain.includes(domainPattern)).map(c => c.name + "=" + c.value).join("; ");
}

function writeCookies(cookiesData) {
  const dir = path.dirname(COOKIE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookiesData, null, 2));
}


const ALL_TERMS = [
  {xnm:"2023",xqm:"11"},{xnm:"2023",xqm:"12"},
  {xnm:"2024",xqm:"11"},{xnm:"2024",xqm:"12"},
  {xnm:"2025",xqm:"11"},{xnm:"2025",xqm:"12"},
];

async function runCycle() {
  const cookies = loadCookies();
  if (!cookies) return { success: false, error: "NO_COOKIES", message: "Run: npm run login or POST /upload-cookies" };
  const cs = buildCookieHeader(cookies, "newjwc.tyust.edu.cn");
  if (!cs) return { success: false, error: "NO_JSESSIONID", message: "Missing JWXT session cookie. Upload via POST /upload-cookies" };
  try {
    await axios.get("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",{headers:{"Cookie":cs},maxRedirects:0,validateStatus:s=>true,timeout:10000}).catch(()=>{});
    var allGrades=[];
    var sessionExpired=false;
    for(var i=0;i<ALL_TERMS.length;i++){
      if(sessionExpired)break;
      var t=ALL_TERMS[i];
      try{
        var resp=await axios.post(
          "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query",
          new URLSearchParams({xnm:t.xnm,xqm:t.xqm,page:"1",rows:"50"}).toString(),
          {headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":cs,"Referer":"https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default"},maxRedirects:0,validateStatus:function(s){return true;},timeout:30000}
        );
        if(resp.status===302){sessionExpired=true;break;}
        if(resp.status!==200)continue;
        var data=resp.data;
        var grades=[];
        if(Array.isArray(data))grades=data;
        else if(data.items)grades=data.items;
        else if(data.rows)grades=data.rows;
        for(var g=0;g<grades.length;g++)allGrades.push(grades[g]);
      }catch(e){continue;}
    }
    if(sessionExpired)return{success:false,error:"COOKIES_EXPIRED",message:"Cookies expired. Re-upload via POST /upload-cookies"};
    if(!allGrades.length)return{success:true,gradesCount:0,added:[],changed:[],grades:[]};
    var diff=storage.diffGrades(allGrades);
    storage.mergeGrades(allGrades);
    if(diff.added.length||diff.changed.length)storage.addGradeChange({type:"update"});
    storage.updateLastRun();
    return{success:true,gradesCount:allGrades.length,added:diff.added.map(function(g){return{kcmc:g.KCMC||g.kcmc,cj:g.CJ||g.cj};}),changed:diff.changed,grades:[]};
  }catch(err){
    return{success:false,error:"REQUEST_FAILED",message:err.message};
  }
}

module.exports = { runCycle, loadCookies, writeCookies };
