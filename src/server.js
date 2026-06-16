const express = require("express");
const { runCycle, loadCookies, writeCookies } = require("./checker");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");

const app = express();
const PORT = process.env.PORT || 3456;
app.use(express.json({ limit: "1mb" }));

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
    totalGrades: storage.getGrades().length,
    lastCheckAt: storage.data?.lastRunAt || null,
    version: "1.0.0",
  });
});

// GET /grades
app.get("/grades", (req, res) => {
  const grades = storage.getGrades().map(g => ({
    kcmc: g.KCMC || g.kcmc, cj: g.CJ || g.cj, xf: g.XF || g.xf,
    xnm: g.XNM || g.xnm, xqm: g.XQM || g.xqm,
  }));
  res.json({ count: grades.length, grades });
});

// POST /check
app.post("/check", async (req, res) => {
  const r = await runCycle();
  if (r.success) res.json({ checked: true, gradesCount: r.gradesCount, added: r.added, changed: r.changed, error: null });
  else res.json({ checked: false, gradesCount: 0, added: [], changed: [], error: r.error, message: r.message });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log("API running on http://localhost:" + PORT);
  console.log("Endpoints: GET /status  GET /grades  POST /check  POST /upload-cookies");
});
