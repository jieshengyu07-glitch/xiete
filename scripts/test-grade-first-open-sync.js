const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-grade-first-open-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = testDataDir;

function testSyncStateFilePersistence() {
  const userPersistence = require("../src/services/userPersistence");
  const { getUserPaths } = require("../src/services/userPaths");
  const userId = "grade_first_open_sync_file_user";
  const startedAt = new Date().toISOString();

  userPersistence.updateSyncState(userId, {
    status: "running",
    type: "grades",
    startedAt,
    finishedAt: "",
    errorCode: ""
  }, "grades");
  let saved = JSON.parse(fs.readFileSync(getUserPaths(userId).syncPath, "utf8"));
  assert.strictEqual(saved.status, "running");
  assert.strictEqual(saved.type, "grades");
  assert.strictEqual(saved.startedAt, startedAt);

  const finishedAt = new Date().toISOString();
  userPersistence.updateSyncState(userId, {
    status: "success",
    finishedAt,
    errorCode: ""
  }, "grades");
  saved = JSON.parse(fs.readFileSync(getUserPaths(userId).syncPath, "utf8"));
  assert.strictEqual(saved.status, "success");
  assert.strictEqual(saved.finishedAt, finishedAt);
  assert.strictEqual(saved.tasks.grades.status, "success");
  console.log("gradeSyncStateFilePersistenceTest=passed");
}

async function testSyncRunningState() {
  const checkerPath = require.resolve("../src/checker");
  const storagePath = require.resolve("../src/db/storage");
  const credentialPath = require.resolve("../src/services/credentialStore");
  const persistencePath = require.resolve("../src/services/userPersistence");
  const sessionPath = require.resolve("../src/sync/userSession");
  const campusStatePath = require.resolve("../src/services/campusLoginState");
  const gradeSyncPath = require.resolve("../src/sync/gradeSync");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const statePatches = [];

  require.cache[checkerPath] = { exports: { runCycleForUser: async () => { await gate; return { success: true }; } } };
  require.cache[storagePath] = { exports: { createStorageForUser: () => ({}) } };
  require.cache[credentialPath] = { exports: {
    getJwxtCredentials: () => ({ present: true }),
    updateBoundAccountStatus: () => true
  } };
  require.cache[persistencePath] = {
    exports: {
      initUserData: () => {},
      mirrorFromStorage: () => {},
      updateSyncState: (userId, patch) => { statePatches.push(Object.assign({}, patch)); },
      saveCampusState: () => {}
    }
  };
  require.cache[sessionPath] = { exports: { ensureUserSession: () => ({}) } };
  delete require.cache[campusStatePath];
  delete require.cache[gradeSyncPath];

  const gradeSync = require(gradeSyncPath);
  const task = gradeSync.scheduleUserGradeSync("sync-state-user", "test");
  assert.strictEqual(gradeSync.isUserGradeSyncRunning("sync-state-user"), true);
  assert.strictEqual(statePatches[0].status, "running");
  assert.strictEqual(statePatches[0].type, "grades");
  assert.ok(statePatches[0].startedAt);
  release();
  await task;
  assert.strictEqual(gradeSync.isUserGradeSyncRunning("sync-state-user"), false);
  assert.strictEqual(statePatches[statePatches.length - 1].status, "success");
  assert.ok(statePatches[statePatches.length - 1].finishedAt);
  console.log("gradeSyncRunningStateTest=passed");
}

async function testSyncFailedState() {
  const checkerPath = require.resolve("../src/checker");
  const storagePath = require.resolve("../src/db/storage");
  const credentialPath = require.resolve("../src/services/credentialStore");
  const persistencePath = require.resolve("../src/services/userPersistence");
  const sessionPath = require.resolve("../src/sync/userSession");
  const campusStatePath = require.resolve("../src/services/campusLoginState");
  const gradeSyncPath = require.resolve("../src/sync/gradeSync");
  const statePatches = [];

  require.cache[checkerPath] = { exports: { runCycleForUser: async () => ({ success: false, error: "JWXT_UNAVAILABLE" }) } };
  require.cache[storagePath] = { exports: { createStorageForUser: () => ({}) } };
  require.cache[credentialPath] = { exports: {
    getJwxtCredentials: () => ({ present: true }),
    updateBoundAccountStatus: () => true
  } };
  require.cache[persistencePath] = {
    exports: {
      initUserData: () => {},
      mirrorFromStorage: () => {},
      updateSyncState: (userId, patch) => { statePatches.push(Object.assign({}, patch)); },
      saveCampusState: () => {}
    }
  };
  require.cache[sessionPath] = { exports: { ensureUserSession: () => ({}) } };
  delete require.cache[campusStatePath];
  delete require.cache[gradeSyncPath];

  const gradeSync = require(gradeSyncPath);
  await gradeSync.syncUserGrades("sync-failed-user", { reason: "test" });
  assert.strictEqual(statePatches[0].status, "running");
  assert.strictEqual(statePatches[statePatches.length - 1].status, "failed");
  assert.strictEqual(statePatches[statePatches.length - 1].errorCode, "JWXT_UNAVAILABLE");
  assert.ok(statePatches[statePatches.length - 1].finishedAt);
  console.log("gradeSyncFailedStateTest=passed");
}

async function testFirstOpenPolling() {
  const template = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/grades/grades.wxml"), "utf8");
  assert.strictEqual(template.includes('wx:if="{{syncing}}"'), true);
  assert.strictEqual(template.includes('wx:if="{{!syncing && grades.length===0}}"'), true);
  assert.strictEqual(template.includes('wx:if="{{grades.length>0}}"'), true);

  const originalGetApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  const api = require("../weapp/utils/api");
  const originalRequest = api.request;
  const originalPage = global.Page;
  let definition;
  const responses = [
    { grades: [], count: 0, syncing: true, syncStatus: "running", warning: false },
    { grades: [{ courseName: "Test Course", score: "90" }], count: 1, syncing: false, syncStatus: "success", warning: false }
  ];

  api.request = async () => responses.shift();
  global.Page = value => { definition = value; };
  const pagePath = require.resolve("../weapp/pages/grades/grades");
  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    _gradesPageActive: true,
    setData(patch) { Object.assign(this.data, patch); }
  });
  let pollingScheduled = 0;
  page.scheduleSyncPolling = () => { pollingScheduled += 1; };

  try {
    await page.loadGrades();
    assert.strictEqual(page.data.syncing, true);
    assert.strictEqual(page.data.count, 0);
    assert.strictEqual(page.data.notice, "正在同步成绩...");
    assert.strictEqual(page.data.error, null);
    assert.strictEqual(pollingScheduled, 1);

    await page.loadGrades({ polling: true });
    assert.strictEqual(page.data.syncing, false);
    assert.strictEqual(page.data.count, 1);
    assert.strictEqual(page.data.grades.length, 1);
    console.log("firstOpenAutomaticRefreshTest=passed");
  } finally {
    api.request = originalRequest;
    global.Page = originalPage;
    global.getApp = originalGetApp;
  }
}

Promise.resolve()
  .then(testSyncStateFilePersistence)
  .then(testSyncRunningState)
  .then(testSyncFailedState)
  .then(testFirstOpenPolling)
  .finally(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  })
  .catch(err => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
