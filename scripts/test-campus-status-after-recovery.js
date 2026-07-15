const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-status-recovery-"));
const userId = "status-recovery-user";
const xgUserId = "status-xg-user";
const jwtSecret = "status-recovery-jwt-secret-0123456789-abcdef";

function request(port, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/status",
      headers: { Authorization: "Bearer " + token }
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("server exited early");
    try {
      const response = await new Promise((resolve, reject) => {
        http.get("http://127.0.0.1:" + port + "/health", resolve).on("error", reject);
      });
      response.resume();
      if (response.statusCode === 200) return;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server start timed out");
}

async function main() {
  process.env.DATA_DIR = dataDir;
  process.env.CREDENTIAL_SECRET = "status-recovery-credential-secret-0123456789-abcdef";

  const credentialStore = require("../src/services/credentialStore");
  credentialStore.saveBoundAccount("student-test", "password-test", userId);
  credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
    lastFailedSyncAt: new Date(Date.now() - 1000).toISOString(),
    lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
    lastJwxtErrorMessage: "expired"
  });

  const checkerPath = require.resolve("../src/checker");
  require.cache[checkerPath] = {
    id: checkerPath,
    filename: checkerPath,
    loaded: true,
    exports: {
      runCycleForUser: async () => ({
        success: true,
        gradesCount: 60,
        gradeSource: "jwxt",
        added: [],
        changed: []
      })
    }
  };
  const gradeSyncPath = require.resolve("../src/sync/gradeSync");
  delete require.cache[gradeSyncPath];
  const { syncUserGrades } = require("../src/sync/gradeSync");
  const result = await syncUserGrades(userId);
  assert.strictEqual(result.success, true);
  assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "cookies.json")), false);

  const meta = credentialStore.readBoundAccountMeta(userId);
  assert.strictEqual(meta.jwxtStatus, "OK");
  assert.strictEqual(meta.lastJwxtError, null);

  credentialStore.saveBoundAccount("student-xg", "password-xg", xgUserId);
  credentialStore.updateBoundAccountStatus(xgUserId, "UNAVAILABLE", {
    lastFailedSyncAt: new Date(Date.now() - 1000).toISOString(),
    lastJwxtError: "JWXT_UNAVAILABLE",
    lastJwxtErrorMessage: "jwxt unavailable"
  });
  const { markCampusLoginValid } = require("../src/services/campusLoginState");
  markCampusLoginValid(xgUserId, "xg");
  const userPersistence = require("../src/services/userPersistence");
  userPersistence.updateSyncState(xgUserId, {
    status: "failed",
    type: "timetable",
    finishedAt: new Date().toISOString(),
    errorCode: "TIMETABLE_SYNC_FAILED",
    lastError: "TIMETABLE_SYNC_FAILED"
  }, "timetable");

  const port = 3900 + Math.floor(Math.random() * 400);
  const env = Object.assign({}, process.env, {
    NODE_ENV: "development",
    DATA_DIR: dataDir,
    JWT_SECRET: jwtSecret,
    DISABLE_SCHEDULER: "1",
    PORT: String(port)
  });
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForServer(port, child);
    const token = jwt.sign({ userId }, jwtSecret, { expiresIn: "5m" });
    const status = await request(port, token);
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.data.campusLoginStatus, "valid");
    assert.strictEqual(status.data.gradeQueryStatus, "ready");
    assert.strictEqual(status.data.lastJwxtError, null);
    assert.notStrictEqual(status.data.campusLoginStatus, "relogin_required");
    console.log("cookieDeletedCheckRecoveryStatusValidTest=passed");

    const xgToken = jwt.sign({ userId: xgUserId }, jwtSecret, { expiresIn: "5m" });
    const xgStatus = await request(port, xgToken);
    assert.strictEqual(xgStatus.data.campusLoginStatus, "valid");
    assert.strictEqual(xgStatus.data.gradeQueryStatus, "ready");
    assert.notStrictEqual(xgStatus.data.jwxtStatus, "OK");
    assert.strictEqual(xgStatus.data.xgSessionStatus, "valid");
    assert.strictEqual(xgStatus.data.timetableSyncStatus, "failed");
    console.log("xgSuccessDoesNotOverwriteJwxtStatusTest=passed");

    userPersistence.updateSyncState(xgUserId, {
      status: "running",
      type: "timetable",
      startedAt: new Date().toISOString(),
      finishedAt: "",
      errorCode: "",
      lastError: ""
    }, "timetable");
    const timetableRunningStatus = await request(port, xgToken);
    assert.strictEqual(timetableRunningStatus.data.timetableSyncStatus, "running");
    assert.strictEqual(timetableRunningStatus.data.campusLoginStatus, "valid");
    assert.strictEqual(timetableRunningStatus.data.gradeQueryStatus, "ready");
    console.log("timetableRunningDoesNotOverrideGradeOrCampusStatusTest=passed");

    const failedAt = new Date(Date.now() + 1000).toISOString();
    credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
      lastFailedSyncAt: failedAt,
      lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
      lastJwxtErrorMessage: "recovery failed"
    });
    userPersistence.updateSyncState(userId, {
      status: "failed",
      type: "campus",
      finishedAt: failedAt,
      errorCode: "ACCOUNT_RELOGIN_REQUIRED",
      lastError: "ACCOUNT_RELOGIN_REQUIRED"
    }, "campus");
    const failedStatus = await request(port, token);
    assert.strictEqual(failedStatus.data.campusLoginStatus, "relogin_required");
    assert.strictEqual(failedStatus.data.gradeQueryStatus, "login_required");
    console.log("automaticRecoveryFailureReloginRequiredTest=passed");
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.error(err);
  process.exitCode = 1;
});
