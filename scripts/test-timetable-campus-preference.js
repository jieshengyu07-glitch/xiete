const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "development";
const previousDataDir = process.env.DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-assistant-campus-preference-"));
process.env.DATA_DIR = testDataDir;

const {
  resolveClassPeriods,
  normalizeCampusCode
} = require("../src/timetable/classPeriods");
const userPreferenceRuntime = require("../src/services/userPreferenceRuntime");

function time(config, section) {
  const period = config.classPeriods.find(item => item.section === section);
  return period && period.startTime + "-" + period.endTime;
}

const winterBefore = resolveClassPeriods({ date: "2026-05-05T23:59:00+08:00", campusCode: "WANBAILIN" });
const summerStart = resolveClassPeriods({ date: "2026-05-06T00:00:00+08:00", campusCode: "WANBAILIN" });
const summerEnd = resolveClassPeriods({ date: "2026-10-08T23:59:00+08:00", campusCode: "WANBAILIN" });
const winterStart = resolveClassPeriods({ date: "2026-10-09T00:00:00+08:00", campusCode: "WANBAILIN" });
assert.strictEqual(winterBefore.scheduleCode, "WANBAILIN_WINTER");
assert.strictEqual(summerStart.scheduleCode, "WANBAILIN_SUMMER");
assert.strictEqual(summerEnd.scheduleCode, "WANBAILIN_SUMMER");
assert.strictEqual(winterStart.scheduleCode, "WANBAILIN_WINTER");
assert.strictEqual(time(winterBefore, 5), "19:00-20:40");
assert.strictEqual(time(summerStart, 5), "19:30-21:10");

for (const date of ["2026-01-01", "2026-05-06", "2026-10-09", "2026-12-31"]) {
  const fixed = resolveClassPeriods({ date, campusCode: "JINYUAN" });
  assert.strictEqual(fixed.scheduleCode, "JINYUAN_FIXED");
  assert.strictEqual(time(fixed, 5), "19:30-21:10");
}

const unknown = resolveClassPeriods({ date: "2026-06-01", campusCode: "" });
assert.strictEqual(unknown.campusSelectionRequired, true);
assert.strictEqual(time(unknown, 4), "16:30-18:10");
assert.strictEqual(time(unknown, 5), "-");
assert.strictEqual(normalizeCampusCode("other"), "");

async function persistenceTest() {
  const userId = "campus-preference-test-user";
  assert.strictEqual(await userPreferenceRuntime.getDefaultCampusCode(userId), "");
  assert.strictEqual(await userPreferenceRuntime.setDefaultCampusCode(userId, "WANBAILIN"), "WANBAILIN");
  assert.strictEqual(await userPreferenceRuntime.getDefaultCampusCode(userId), "WANBAILIN");
  assert.strictEqual(await userPreferenceRuntime.setDefaultCampusCode(userId, "JINYUAN"), "JINYUAN");
  assert.strictEqual(await userPreferenceRuntime.getDefaultCampusCode(userId), "JINYUAN");
  await assert.rejects(() => userPreferenceRuntime.setDefaultCampusCode(userId, "free text"), err => err.code === "INVALID_CAMPUS_CODE");
}

async function timetableUiTest() {
  const originalGetApp = global.getApp;
  const originalPage = global.Page;
  const originalWx = global.wx;
  global.getApp = () => ({ globalData: { authEpoch: 0 } });
  global.wx = {
    getStorageSync: () => "token",
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    showModal() {},
    navigateTo() {}
  };
  let definition;
  global.Page = value => { definition = value; };
  const apiPath = require.resolve("../weapp/utils/api");
  const pagePath = require.resolve("../weapp/pages/timetable/timetable");
  delete require.cache[apiPath];
  delete require.cache[pagePath];
  const api = require("../weapp/utils/api");
  let readCalls = 0;
  let postCalls = 0;
  api.request = async () => { readCalls += 1; throw new Error("unexpected timetable reload"); };
  api.post = async (_path, body) => {
    postCalls += 1;
    return Object.assign(
      { success: true, defaultCampusCode: body.defaultCampusCode },
      resolveClassPeriods({ date: body.date, campusCode: body.defaultCampusCode })
    );
  };
  require(pagePath);
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data, { viewMode: "today" }),
    setData(patch) { Object.assign(this.data, patch); }
  });
  const base = {
    date: "2026-06-01",
    weekday: 1,
    termStatus: "IN_TERM",
    hasTimetable: true,
    syncing: false,
    classPeriods: unknown.classPeriods,
    sections: [{ section: 5, courses: [{ id: "evening", section: 5, courseName: "匿名晚间选修课" }] }]
  };
  page.applyToday(base);
  assert.strictEqual(page.data.showCampusChooser, true);
  assert.strictEqual(page.data.todayCourses[0].timeText, "第9-10节");

  await page.selectCampus({ currentTarget: { dataset: { campusCode: "WANBAILIN" } } });
  assert.strictEqual(page.data.showCampusChooser, false);
  assert.strictEqual(page.data.defaultCampusCode, "WANBAILIN");
  assert.strictEqual(page.data.todayCourses[0].timeText, "19:30—21:10");
  assert.strictEqual(readCalls, 0);
  assert.strictEqual(postCalls, 1);

  page.applyToday(Object.assign({}, base, summerStart, { defaultCampusCode: "WANBAILIN" }));
  assert.strictEqual(page.data.showCampusChooser, false, "returning user must not be prompted again");

  await page.selectCampus({ currentTarget: { dataset: { campusCode: "JINYUAN" } } });
  assert.strictEqual(page.data.defaultCampusCode, "JINYUAN");
  assert.strictEqual(page.data.todayCourses[0].timeText, "19:30—21:10");
  assert.strictEqual(readCalls, 0);
  assert.strictEqual(postCalls, 2);

  let settingsDefinition;
  global.Page = value => { settingsDefinition = value; };
  const settingsPath = require.resolve("../weapp/pages/settings/settings");
  delete require.cache[settingsPath];
  require(settingsPath);
  const settings = Object.assign({}, settingsDefinition, {
    data: Object.assign({}, settingsDefinition.data),
    setData(patch) { Object.assign(this.data, patch); }
  });
  await settings.saveCampusPreference("WANBAILIN");
  assert.strictEqual(settings.data.defaultCampusCode, "WANBAILIN");
  assert.strictEqual(settings.data.campusName, "万柏林校区");
  assert.strictEqual(postCalls, 3);
  assert.strictEqual(readCalls, 0);

  global.getApp = originalGetApp;
  global.Page = originalPage;
  global.wx = originalWx;
}

function staticIsolationTest() {
  const server = fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8");
  const route = server.slice(server.indexOf('app.post("/preferences/campus"'), server.indexOf("// GET /grades"));
  assert(route.includes("userPreferenceRuntime.setDefaultCampusCode"));
  assert(!/syncTimetableForUser|scheduleUserTimetableSync|campusCacheRuntime|replaceTimetable|saveTimetable/.test(route));
  const migration = fs.readFileSync(path.join(__dirname, "../src/db/migrate.js"), "utf8");
  assert(migration.includes("default_campus_code"));
  assert(migration.includes("'WANBAILIN', 'JINYUAN'"));
  const bindingRepository = fs.readFileSync(path.join(__dirname, "../src/repositories/jwxtBindingRepository.js"), "utf8");
  assert(!bindingRepository.includes("default_campus_code"));
}

Promise.resolve()
  .then(persistenceTest)
  .then(timetableUiTest)
  .then(staticIsolationTest)
  .then(() => console.log("campusPreferencePersistenceScheduleBoundaryUiAndIsolationTest=passed"))
  .catch(err => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });
