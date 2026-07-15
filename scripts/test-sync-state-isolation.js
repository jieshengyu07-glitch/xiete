const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-sync-state-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = dataDir;
process.env.CREDENTIAL_SECRET = process.env.CREDENTIAL_SECRET || "sync-state-test-credential-secret-0123456789";

const persistence = require("../src/services/userPersistence");

try {
  const userId = "sync-state-user";
  persistence.updateSyncState(userId, {
    status: "running",
    startedAt: "2026-07-15T00:00:00.000Z"
  }, "grades");
  persistence.updateSyncState(userId, {
    status: "success",
    finishedAt: "2026-07-15T00:01:00.000Z"
  }, "timetable");

  const grades = persistence.readSyncState(userId, "grades");
  const timetable = persistence.readSyncState(userId, "timetable");
  assert.strictEqual(grades.status, "running");
  assert.strictEqual(grades.startedAt, "2026-07-15T00:00:00.000Z");
  assert.strictEqual(timetable.status, "success");
  assert.strictEqual(timetable.finishedAt, "2026-07-15T00:01:00.000Z");
  console.log("gradeTimetableSyncStateIsolationTest=passed");
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
