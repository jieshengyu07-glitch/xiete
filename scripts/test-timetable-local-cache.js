const assert = require("assert");

function createStorage(initial) {
  const values = Object.assign({}, initial || {});
  return {
    values,
    getStorageSync(key) { return values[key]; },
    setStorageSync(key, value) { values[key] = value; },
    removeStorageSync(key) { delete values[key]; }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const storage = createStorage({ token: "opaque-test-token" });
global.wx = Object.assign(storage, {
  showToast() {},
  showModal() {},
  navigateTo() {},
  stopPullDownRefresh() {}
});
global.getApp = () => ({ globalData: { authEpoch: 0 } });

const timetableCache = require("../weapp/utils/timetableCache");
const api = require("../weapp/utils/api");

let pageDefinition;
global.Page = value => { pageDefinition = value; };
require("../weapp/pages/timetable/timetable");

function createPage(extra) {
  const page = Object.assign({}, pageDefinition, extra || {});
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page._timetablePageActive = true;
  page.setData = function setData(patch) { Object.assign(this.data, patch); };
  page.stopSyncPolling = page.stopSyncPolling.bind(page);
  page.stopInitialConnectionTimer = page.stopInitialConnectionTimer.bind(page);
  return page;
}

function todayPayload(name, campusCode, periods) {
  return {
    success: true,
    date: "2026-09-14",
    weekday: 1,
    termYear: "2026",
    termSemester: "3",
    currentTeachingWeek: 2,
    weekType: "EVEN",
    termStatus: "IN_TERM",
    hasTimetable: true,
    syncing: false,
    defaultCampusCode: campusCode || "WANBAILIN",
    classPeriods: periods || [{ section: 1, startTime: "08:00", endTime: "09:40" }],
    sections: [{ section: 1, courses: [{ id: "c1", section: 1, courseName: name || "cached-course" }] }]
  };
}

function weekPayload(name) {
  return {
    success: true,
    date: "2026-09-14",
    weekday: 1,
    termYear: "2026",
    termSemester: "3",
    currentTeachingWeek: 2,
    weekType: "EVEN",
    termStatus: "IN_TERM",
    hasTimetable: true,
    syncing: false,
    defaultCampusCode: "WANBAILIN",
    classPeriods: [{ section: 1, startTime: "08:00", endTime: "09:40" }],
    days: [{ weekday: 1, sections: [{ section: 1, courses: [{ id: "w1", section: 1, courseName: name || "week-course" }] }] }]
  };
}

async function noCacheFirstOpenWritesCacheTest() {
  timetableCache.clearTimetableCaches(storage);
  storage.setStorageSync("token", "user-a-token");
  const gate = deferred();
  const originalRequest = api.request;
  api.request = () => gate.promise;
  const page = createPage();
  const task = page.loadToday();
  assert.strictEqual(page.data.isInitialLoading, true);
  assert.strictEqual(timetableCache.read("today", storage), null);
  gate.resolve(todayPayload("network-course"));
  await task;
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.strictEqual(page.data.todayCourses[0].courseName, "network-course");
  assert.strictEqual(timetableCache.read("today", storage).payload.sections[0].courses[0].courseName, "network-course");
  api.request = originalRequest;
  console.log("noCacheFirstOpenWritesCacheTest=passed");
}

async function cachedTodayFirstPaintAndBackgroundReplaceTest() {
  timetableCache.write("today", todayPayload("old-course"), storage);
  const gate = deferred();
  const originalRequest = api.request;
  api.request = () => gate.promise;
  const page = createPage();
  assert.strictEqual(page.loadCachedToday(), true);
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.strictEqual(page.data.todayCourses[0].courseName, "old-course");
  const task = page.loadToday({ backgroundRefresh: true });
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.strictEqual(page.data.backgroundRefreshing, true);
  gate.resolve(todayPayload("new-course"));
  await task;
  assert.strictEqual(page.data.todayCourses[0].courseName, "new-course");
  assert.strictEqual(page.data.backgroundRefreshing, false);
  api.request = originalRequest;
  console.log("cachedTodayFirstPaintAndBackgroundReplaceTest=passed");
}

async function cachedWeekFirstPaintTest() {
  timetableCache.write("week", weekPayload("week-cache"), storage);
  const page = createPage();
  page.data.viewMode = "week";
  assert.strictEqual(page.loadCachedWeek(), true);
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.strictEqual(page.data.weekDays[0].sections[0].courses[0].courseName, "week-cache");
  console.log("cachedWeekFirstPaintTest=passed");
}

async function cachedNetworkFailurePreservesDataTest() {
  timetableCache.write("today", todayPayload("offline-cache"), storage);
  const originalRequest = api.request;
  api.request = () => Promise.reject(new Error("offline"));
  const page = createPage();
  page.loadCachedToday();
  await page.loadToday({ backgroundRefresh: true });
  assert.strictEqual(page.data.todayCourses[0].courseName, "offline-cache");
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.ok(String(page.data.notice || "").length > 0);
  assert.strictEqual(page.data.error, "");
  api.request = originalRequest;
  console.log("cachedNetworkFailurePreservesDataTest=passed");
}

function corruptionAndSchemaMismatchTest() {
  const namespace = timetableCache.ensureUserNamespace(storage);
  storage.setStorageSync(timetableCache.CACHE_KEYS.today, "broken");
  assert.strictEqual(timetableCache.read("today", storage), null);
  storage.setStorageSync(timetableCache.CACHE_KEYS.today, {
    schemaVersion: timetableCache.TIMETABLE_CACHE_SCHEMA_VERSION + 1,
    userNamespace: namespace,
    viewType: "today",
    cachedAt: Date.now(),
    payload: todayPayload()
  });
  assert.strictEqual(timetableCache.read("today", storage), null);
  console.log("corruptionAndSchemaMismatchTest=passed");
}

function userIsolationAndLogoutTest() {
  timetableCache.beginUserSession(storage);
  timetableCache.write("today", todayPayload("user-a"), storage);
  const namespaceA = timetableCache.ensureUserNamespace(storage);
  timetableCache.beginUserSession(storage);
  const namespaceB = timetableCache.ensureUserNamespace(storage);
  assert.notStrictEqual(namespaceA, namespaceB);
  assert.strictEqual(timetableCache.read("today", storage), null);
  timetableCache.write("today", todayPayload("user-b"), storage);
  timetableCache.clearTimetableCaches(storage);
  storage.removeStorageSync("token");
  assert.strictEqual(timetableCache.read("today", storage), null);
  assert.strictEqual(storage.getStorageSync(timetableCache.USER_NAMESPACE_KEY), undefined);
  storage.setStorageSync("token", "user-b-token");
  timetableCache.beginUserSession(storage);
  console.log("userIsolationAndLogoutTest=passed");
}

function appLogoutIntegrationClearsCacheTest() {
  timetableCache.write("today", todayPayload("before-logout"), storage);
  let appDefinition = null;
  const originalApp = global.App;
  global.App = value => { appDefinition = value; };
  const appPath = require.resolve("../weapp/app");
  delete require.cache[appPath];
  require(appPath);
  appDefinition.globalData = Object.assign({}, appDefinition.globalData);
  appDefinition.invalidateAuth();
  assert.strictEqual(storage.getStorageSync("token"), undefined);
  assert.strictEqual(timetableCache.read("today", storage), null);
  global.App = originalApp;
  storage.setStorageSync("token", "user-b-token");
  timetableCache.beginUserSession(storage);
  console.log("appLogoutIntegrationClearsCacheTest=passed");
}

function campusPreferenceReparsesCachedTimesTest() {
  timetableCache.write("today", todayPayload("campus-course", "WANBAILIN", [
    { section: 1, startTime: "08:00", endTime: "09:40" }
  ]), storage);
  assert.strictEqual(timetableCache.updateCampusPreference("JINYUAN", [
    { section: 1, startTime: "09:00", endTime: "10:40" }
  ], storage), true);
  const page = createPage();
  page.loadCachedToday();
  assert.strictEqual(page.data.defaultCampusCode, "JINYUAN");
  assert.ok(page.data.todayCourses[0].timeText.includes("09:00") && page.data.todayCourses[0].timeText.includes("10:40"));
  console.log("campusPreferenceReparsesCachedTimesTest=passed");
}

async function freshnessInflightAndForceGuardTest() {
  const originalRequest = api.request;
  let calls = 0;
  let gate = deferred();
  api.request = () => { calls += 1; return gate.promise; };
  const page = createPage();
  const first = page.loadToday();
  const duplicate = page.loadToday();
  assert.strictEqual(calls, 1);
  gate.resolve(todayPayload("dedupe-course"));
  await Promise.all([first, duplicate]);
  await page.loadToday();
  assert.strictEqual(calls, 1);
  gate = deferred();
  const forced = page.loadToday({ force: true });
  assert.strictEqual(calls, 2);
  gate.resolve(todayPayload("forced-course"));
  await forced;
  assert.strictEqual(page.data.todayCourses[0].courseName, "forced-course");
  api.request = originalRequest;
  console.log("freshnessInflightAndForceGuardTest=passed");
}

async function manualRefreshUsesServerAndForcesReloadTest() {
  const originalPost = api.post;
  let postCalls = 0;
  let loadOptions = null;
  api.post = async path => { postCalls += 1; assert.strictEqual(path, "/timetable/sync"); return { success: true, syncing: false }; };
  const page = createPage();
  page.data.hasTimetable = true;
  page.data.syncing = false;
  page.startRefreshStageTimer = () => {};
  page.stopRefreshStageTimer = () => {};
  page.loadCurrent = async options => { loadOptions = options; };
  await page.syncTimetable();
  assert.strictEqual(postCalls, 1);
  assert.strictEqual(loadOptions.force, true);
  api.post = originalPost;
  console.log("manualRefreshUsesServerAndForcesReloadTest=passed");
}

async function cacheWriteFailureIsFailOpenTest() {
  const originalWx = global.wx;
  const failingStorage = {
    getStorageSync(key) { return key === "token" ? "token" : ""; },
    setStorageSync() { throw new Error("quota"); },
    removeStorageSync() {},
    showToast() {}, showModal() {}, navigateTo() {}, stopPullDownRefresh() {}
  };
  global.wx = failingStorage;
  const originalRequest = api.request;
  api.request = async () => todayPayload("fail-open-course");
  const page = createPage();
  await page.loadToday();
  assert.strictEqual(page.data.todayCourses[0].courseName, "fail-open-course");
  assert.strictEqual(page.data.isInitialLoading, false);
  assert.strictEqual(timetableCache.write("today", todayPayload(), failingStorage), false);
  api.request = originalRequest;
  global.wx = originalWx;
  console.log("cacheWriteFailureIsFailOpenTest=passed");
}


function sensitiveFieldsNeverPersistTest() {
  timetableCache.clearTimetableCaches(storage);
  storage.setStorageSync("token", "user-sensitive-test-token");
  timetableCache.beginUserSession(storage);

  const payload = todayPayload("sensitive-course");
  payload.token = "secret-token";
  payload.cookie = "secret-cookie";
  payload.password = "secret-password";
  payload.studentId = "secret-student-id";
  payload.nested = {
    authorization: "Bearer secret-authorization",
    cookies: ["secret-cookie-list"],
    jwxtSession: "secret-jwxt-session",
    safeValue: "keep-me"
  };

  assert.strictEqual(timetableCache.write("today", payload, storage), true);

  const raw = storage.getStorageSync(timetableCache.CACHE_KEYS.today);
  const serialized = JSON.stringify(raw);

  assert.ok(!serialized.includes("secret-token"));
  assert.ok(!serialized.includes("secret-cookie"));
  assert.ok(!serialized.includes("secret-password"));
  assert.ok(!serialized.includes("secret-student-id"));
  assert.ok(!serialized.includes("secret-authorization"));
  assert.ok(!serialized.includes("secret-jwxt-session"));
  assert.strictEqual(raw.payload.nested.safeValue, "keep-me");

  console.log("sensitiveFieldsNeverPersistTest=passed");
}
async function run() {
  await noCacheFirstOpenWritesCacheTest();
  await cachedTodayFirstPaintAndBackgroundReplaceTest();
  await cachedWeekFirstPaintTest();
  await cachedNetworkFailurePreservesDataTest();
  corruptionAndSchemaMismatchTest();
  sensitiveFieldsNeverPersistTest();
  userIsolationAndLogoutTest();
  appLogoutIntegrationClearsCacheTest();
  campusPreferenceReparsesCachedTimesTest();
  await freshnessInflightAndForceGuardTest();
  await manualRefreshUsesServerAndForcesReloadTest();
  await cacheWriteFailureIsFailOpenTest();
}

run().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
