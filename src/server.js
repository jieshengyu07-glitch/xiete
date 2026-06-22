const express = require("express");
const { runCycle, loadCookies, writeCookies } = require("./checker");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");
const { httpJwxtLogin } = require("./login/httpJwxtLogin");
const credentialStore = require("./services/credentialStore");

const app = express();
const PORT = process.env.PORT || 3456;
app.use(express.json({ limit: "1mb" }));

function isJwglxtPath(cookiePath) {
  return cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
}

function selectJwxtGradeCookies(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const route = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/");
  const jsession = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path));
  const rememberMe = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path));
  return [route, jsession, rememberMe].filter(Boolean);
}

// Background scheduler
const scheduler = new Scheduler(async () => {
  const r = await runCycle();
  if (r.success) console.log("[bg] " + r.gradesCount + " grades" + (r.added.length ? " +" + r.added.length : "") + (r.changed.length ? " ~" + r.changed.length : ""));
  else console.log("[bg] " + (r.error || r.message));
});
scheduler.start();

// GET /status
app.get("/status", (req, res) => {
  const cookies = loadCookies();
  const valid = !!(cookies?.find(x => x.name === "JSESSIONID" && x.domain?.includes("newjwc")));
  res.json({
    status: "running",
    cookieValid: valid,
    cookieStatus: valid ? "cookie_valid" : "login_required",
    totalGrades: storage.getGrades().length,
    lastCheckAt: storage.data?.lastRunAt || null,
    version: "1.0.0",
  });
});

// GET /grades
function schoolYearName(xnm) {
  if (!xnm) return "未知学年";
  var text = String(xnm);
  if (/^\d{4}$/.test(text)) return text + "-" + (Number(text) + 1);
  return text;
}

function termNumber(xqm) {
  var text = String(xqm || "");
  if (text === "12") return 2;
  if (text === "3") return 1;
  var n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function termLabel(xnm, xqm) {
  var text = String(xqm || "");
  var termName = "未知学期";
  if (text === "3") termName = "第1学期";
  else if (text === "12") termName = "第2学期";
  else if (text) termName = text;
  return schoolYearName(xnm) + "学年" + termName;
}

function buildGroupedGrades(grades) {
  var map = {};
  grades.forEach(function(g) {
    var xnm = g.xnm || "";
    var xqm = g.xqm || "";
    var key = xnm + "_" + xqm;
    if (!map[key]) {
      map[key] = { key: key, xnm: xnm, xqm: xqm, termName: termLabel(xnm, xqm), grades: [] };
    }
    map[key].grades.push(g);
  });
  return Object.keys(map).map(function(k) { return map[k]; }).sort(function(a, b) {
    var ya = parseInt(a.xnm, 10) || 0;
    var yb = parseInt(b.xnm, 10) || 0;
    if (yb !== ya) return yb - ya;
    return termNumber(b.xqm) - termNumber(a.xqm);
  });
}

app.get("/grades", (req, res) => {
  const grades = storage.getGrades().map(g => ({
    kcmc: g.KCMC || g.kcmc, cj: g.CJ || g.cj, xf: g.XF || g.xf,
    xnm: g.XNM || g.xnm, xqm: g.XQM || g.xqm,
  }));
  res.json({ count: grades.length, grades, groupedGrades: buildGroupedGrades(grades) });
});

// POST /check
app.post("/check", async (req, res) => {
  const r = await runCycle();
  if (r.success) res.json({ checked: true, gradesCount: r.gradesCount, added: r.added, changed: r.changed, error: null, cookieStatus: r.cookieStatus || "cookie_valid" });
  else res.json({ checked: false, gradesCount: 0, added: [], changed: [], error: r.error, message: r.message, cookieStatus: r.cookieStatus || r.error || "query_error" });
});

// POST /bind-account
app.post("/bind-account", async (req, res) => {
  const studentId = String((req.body && req.body.studentId) || "").trim();
  const password = String((req.body && req.body.password) || "");

  if (!studentId || !password) {
    return res.status(400).json({
      success: false,
      error: "INVALID_ACCOUNT",
      message: "studentId and password are required"
    });
  }

  try {
    const login = await httpJwxtLogin(studentId, password);
    credentialStore.saveBoundAccount(studentId, password);
    const jwxtCookies = selectJwxtGradeCookies(login.cookies);
    if (jwxtCookies.length) writeCookies(jwxtCookies);
    console.log("[api] JWXT account bound successfully for studentId=" + studentId);
    res.json({
      success: true,
      bound: true,
      finalUrl: login.finalUrl,
      hasJSession: Boolean(login.jwxtJSessionId)
    });
  } catch (err) {
    console.log("[api] JWXT account bind failed for studentId=" + studentId + ": " + err.message);
    res.status(400).json({
      success: false,
      error: "BIND_FAILED",
      message: "账号或密码错误 / 教务系统不可用"
    });
  }
});

// POST /upload-cookies
app.post("/upload-cookies", (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: "INVALID_FORMAT", message: "Body must be a JSON array" });
    }
    for (const c of data) {
      if (!c.name || !c.value) {
        return res.status(400).json({ success: false, error: "INVALID_ENTRY", message: "Each cookie needs name and value" });
      }
    }
    writeCookies(data);
    const hasJSession = data.some(c => c.name === "JSESSIONID");
    if (!hasJSession) {
      writeCookies(data);
      console.log("[api] Cookies uploaded (WARNING: no JSESSIONID)");
      return res.json({ success: true, saved: true, error: "NO_JSESSIONID", message: "No JSESSIONID found. Grade queries will not work.", count: data.length, hasJSession: false });
    }
    writeCookies(data);
    console.log("[api] Cookies uploaded: " + data.length + " entries (includes JSESSIONID)");
    res.json({ success: true, saved: true, count: data.length, hasJSession: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "WRITE_FAILED", message: err.message });
  }
});



// POST /grades/import
app.post("/grades/import", (req, res) => {
  try {
    var d = req.body;
    if (!d || !d.grades) return res.status(400).json({success:false,message:"Missing grades field"});
    var g = d.grades;
    if (typeof g === "string") try { g = JSON.parse(g); } catch(e) {}
    if (!Array.isArray(g)) return res.status(400).json({success:false,message:"grades must be array"});
    require("./db/storage").mergeGrades(g);
    console.log("[api] Imported " + g.length + " grades");
    res.json({success:true,count:g.length});
  } catch(err) {
    res.status(500).json({success:false,message:err.message});
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log("API running on http://localhost:" + PORT);
  console.log("Endpoints: GET /status  GET /grades  POST /check  POST /upload-cookies");
});
