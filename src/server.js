const express = require("express");
const { runCycle } = require("./checker");
const storage = require("./db/storage");
const Scheduler = require("./scheduler/cron");

const app = express();
const PORT = process.env.PORT || 3456;
app.use(express.json());

// Background scheduler
const scheduler = new Scheduler(async () => {
  const r = await runCycle();
  if (r.success) console.log("[bg] " + r.gradesCount + " grades" + (r.added.length ? " +" + r.added.length : "") + (r.changed.length ? " ~" + r.changed.length : ""));
  else console.log("[bg] " + (r.error || r.message));
});
scheduler.start();

// GET /status
app.get("/status", (req, res) => {
  let cookies = null;
  try { cookies = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "cookies.json"), "utf8")); } catch {}
  const valid = !!(cookies?.find(x => x.name === "JSESSIONID" && x.domain.includes("newjwc")));
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

app.listen(PORT, () => console.log("API running on http://localhost:" + PORT));
