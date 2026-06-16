const fs = require("fs");
const path = require("path");
const axios = require("axios");
const storage = require("./db/storage");
const COOKIE_FILE = path.join(__dirname, "..", "data", "cookies.json");

function loadCookies() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8")); } catch { return null; }
}

async function runCycle() {
  const cookies = loadCookies();
  if (!cookies) return { success: false, error: "NO_COOKIES", message: "Run: npm run login" };
  const cs = cookies.filter(c => c.domain.includes("newjwc.tyust.edu.cn")).map(c => c.name + "=" + c.value).join("; ");
  if (!cs) return { success: false, error: "NO_JSESSIONID", message: "Run: npm run login" };
  try {
    const resp = await axios.post("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query",
      new URLSearchParams({ xnm: "2025-2026", xqm: "2" }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cs, "Referer": "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default" },
        maxRedirects: 0, validateStatus: s => true, timeout: 10000 });
    if (resp.status === 302) return { success: false, error: "COOKIES_EXPIRED", message: "Run: npm run login" };
    if (resp.status !== 200) return { success: false, error: "API_ERROR", message: "Status " + resp.status };
    let grades = [];
    const data = resp.data;
    if (Array.isArray(data)) grades = data;
    else if (data.items) grades = data.items;
    else if (data.rows) grades = data.rows;
    if (grades.length === 0) return { success: true, gradesCount: 0, added: [], changed: [], grades: [] };
    const { added, changed } = storage.diffGrades(grades);
    storage.mergeGrades(grades);
    if (added.length > 0 || changed.length > 0) storage.addGradeChange({ type: "update" });
    storage.updateLastRun();
    return { success: true, gradesCount: grades.length, added: added.map(g => ({ kcmc: g.KCMC || g.kcmc, cj: g.CJ || g.cj })), changed, grades: [] };
  } catch (err) {
    return { success: false, error: "REQUEST_FAILED", message: err.message };
  }
}
module.exports = { runCycle };
