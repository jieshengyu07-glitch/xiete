const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  rowsForTerm,
  replaceTermRows,
  shouldScheduleAutomaticSync
} = require("../src/timetable/cachePolicy");

const root = path.resolve(__dirname, "..");
const currentTerm = { termYear: "2026", termSemester: "3" };
const nextTerm = { termYear: "2026", termSemester: "12" };
const oldCurrentRow = { id: "current-old", termYear: "2026", termSemester: "3", courseName: "旧课表" };
const previousTermRow = { id: "previous", termYear: "2025", termSemester: "12", courseName: "上学期课程" };
const newCurrentRow = { id: "current-new", termYear: "2026", termSemester: "3", courseName: "新课表" };
const cache = [previousTermRow, oldCurrentRow];

const ancientUpdatedAt = "2000-01-01T00:00:00.000Z";
assert.strictEqual(shouldScheduleAutomaticSync({
  userId: "user",
  hasCredentials: true,
  currentTermRows: rowsForTerm(cache, currentTerm),
  syncState: { status: "success", finishedAt: ancientUpdatedAt },
  updatedAt: ancientUpdatedAt,
  now: Date.now(),
  failedRetryIntervalMs: 60000
}), false);
console.log("oldCurrentTermCacheNeverAutoRefreshesTest=passed");

assert.strictEqual(shouldScheduleAutomaticSync({
  userId: "user",
  hasCredentials: true,
  currentTermRows: [],
  syncState: { status: "success", finishedAt: new Date().toISOString() },
  now: Date.now(),
  failedRetryIntervalMs: 60000
}), true);
assert.deepStrictEqual(rowsForTerm(cache, nextTerm), []);
console.log("missingOrChangedTermAllowsInitialSyncTest=passed");

const replaced = replaceTermRows(cache, currentTerm, [newCurrentRow]);
assert.deepStrictEqual(replaced, [previousTermRow, newCurrentRow]);
assert.deepStrictEqual(cache, [previousTermRow, oldCurrentRow]);
console.log("successfulRefreshReplacesOnlyCurrentTermTest=passed");

const syncWorker = fs.readFileSync(path.join(root, "src/sync/timetableSync.js"), "utf8");
const timetableSync = fs.readFileSync(path.join(root, "src/timetable/sync.js"), "utf8");
const successBranch = syncWorker.indexOf("if (result && result.success)");
const persistentReplace = syncWorker.indexOf("replaceTermRows(", successBranch);
assert(successBranch >= 0 && persistentReplace > successBranch);
assert(timetableSync.indexOf("if (rows.length === 0)") < timetableSync.indexOf("storage.replaceTimetableForTerm"));
assert.match(syncWorker, /catch \(cacheErr\)[\s\S]*return \{ success: false, error: "CACHE_PERSISTENCE_FAILED"/);
console.log("failedRefreshPreservesOldCacheTest=passed");

const server = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
const policyStart = server.indexOf("async function maybeScheduleTimetableSync");
const policyEnd = server.indexOf("function sendTermConfigError", policyStart);
const automaticPolicy = server.slice(policyStart, policyEnd);
assert.match(automaticPolicy, /shouldScheduleAutomaticSync/);
assert.doesNotMatch(automaticPolicy, /AUTO_GRADE_SYNC_INTERVAL_MS|timetable_updated_at|updatedAt|stale|TTL/i);
for (const route of ["today", "week"]) {
  const routeStart = server.indexOf(`app.get("/timetable/${route}"`);
  const routeEnd = server.indexOf(route === "today" ? "// GET /timetable/week" : "// POST /timetable/sync", routeStart);
  const routeSource = server.slice(routeStart, routeEnd);
  assert.match(routeSource, /termRowsForRequest\(req\)/);
  assert.match(routeSource, /maybeScheduleTimetableSync\(req\.userId, rows\)/);
}
console.log("todayAndWeekIgnoreCacheAgeTest=passed");

const postStart = server.indexOf('app.post("/timetable/sync"');
const postEnd = server.indexOf("// POST /bind-account", postStart);
const manualRoute = server.slice(postStart, postEnd);
assert.match(manualRoute, /const \{ rows: cachedRows \} = await termRowsForRequest\(req\)/);
assert.match(manualRoute, /scheduleUserTimetableSync\(req\.userId\)/);
assert.doesNotMatch(manualRoute, /cooldown\.cooledDown/);
console.log("manualRefreshAndPersistentCacheDetectionTest=passed");

const runtime = fs.readFileSync(path.join(root, "src/services/campusCacheRuntime.js"), "utf8");
assert.match(runtime, /timetable_payload/);
assert.match(runtime, /timetable_updated_at/);
assert.match(runtime, /repo\.save\(userId,"timetable"/);
console.log("postgresPersistenceAndRestartAuthorityTest=passed");

const frontend = fs.readFileSync(path.join(root, "weapp/pages/timetable/timetable.js"), "utf8");
assert.match(frontend, /课表刷新失败，已保留原课表/);
assert.match(frontend, /api\.post\("\/timetable\/sync"/);
assert.match(frontend, /api\.request\("\/timetable\/today"\)/);
assert.match(frontend, /api\.request\("\/timetable\/week"\)/);
console.log("frontendManualRefreshFailureKeepsVisibleCacheTest=passed");

assert.strictEqual(fs.existsSync(path.join(root, "src/grade")), true);
assert.doesNotMatch(fs.readFileSync(path.join(root, "src/grade/gradeNormalizer.js"), "utf8"), /cachePolicy/);
console.log("gradesRemainIndependentTest=passed");
