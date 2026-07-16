const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "performance-flow-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = dataDir;
const checker = require("../src/checker");

async function concurrencyLimitTest() {
  let active = 0;
  let maximum = 0;
  const startedAt = Date.now();
  const values = await checker._performance.mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 40));
    active -= 1;
    return value * 2;
  });
  const elapsed = Date.now() - startedAt;
  assert.deepStrictEqual(values, [2, 4, 6, 8, 10, 12]);
  assert.strictEqual(maximum, 3);
  assert(elapsed < 190, "queries should run in bounded parallel batches");
  console.log("boundedGradeQueryConcurrencyTest=passed");
}

function nonBlockingUxSourceTest() {
  const server = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
  const grades = fs.readFileSync(path.join(root, "weapp", "pages", "grades", "grades.js"), "utf8");
  const timetable = fs.readFileSync(path.join(root, "weapp", "pages", "timetable", "timetable.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "weapp", "pages", "settings", "settings.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "weapp", "app.js"), "utf8");
  const gradesView = fs.readFileSync(path.join(root, "weapp", "pages", "grades", "grades.wxml"), "utf8");
  const timetableView = fs.readFileSync(path.join(root, "weapp", "pages", "timetable", "timetable.wxml"), "utf8");

  assert.match(server, /scheduleUserGradeSync\(req\.userId, "manual-refresh"/);
  assert.match(server, /skipJwxt = cooldown\.cooledDown && channelMode === "auto"/);
  assert.match(server, /scheduleUserTimetableSync\(req\.userId\)/);
  assert.match(server, /scheduleBindCompletion\(req\.userId, portal\)/);
  assert.match(grades, /result && result\.syncing/);
  assert.match(timetable, /result && result\.syncing/);
  assert.doesNotMatch(grades, /showLoading\(\{ title: "刷新成绩/);
  assert.doesNotMatch(timetable, /showLoading\(\{ title: "刷新课表/);
  assert.doesNotMatch(settings, /showLoading\(\{ title: "绑定中/);
  assert.match(app, /if \(this\.globalData\.loginPromise\) return this\.globalData\.loginPromise/);
  assert.match(gradesView, /wx:if="\{\{grades\.length>0\}\}"/);
  assert.match(timetableView, /\(!syncing \|\| hasTimetable\)/);
  console.log("nonBlockingRefreshAndBindUxTest=passed");
}

concurrencyLimitTest()
  .then(nonBlockingUxSourceTest)
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dataDir, { recursive: true, force: true }));
