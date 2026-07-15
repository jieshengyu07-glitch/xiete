const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const mode = process.argv[2] || "parent";
const userId = "data_dir_persistence_test_user";

function loadModules() {
  const { getUserPaths } = require("../src/services/userPaths");
  const userPersistence = require("../src/services/userPersistence");
  return { getUserPaths, userPersistence };
}

if (mode === "write") {
  const { getUserPaths, userPersistence } = loadModules();
  userPersistence.saveBoundProfile(userId, "20230001");
  userPersistence.saveGradesCache(userId, [{ courseName: "Persistent Course", score: "88" }]);
  userPersistence.saveTimetableCache(userId, [{ courseName: "Persistent Timetable" }]);
  userPersistence.updateSyncState(userId, { status: "ok" });
  console.log(JSON.stringify({ userDir: getUserPaths(userId).userDir }));
} else if (mode === "read") {
  const { getUserPaths, userPersistence } = loadModules();
  const profile = userPersistence.readProfile(userId);
  const grades = userPersistence.readGradesCache(userId);
  const timetable = userPersistence.readTimetableCache(userId);
  const sync = userPersistence.readSyncState(userId);
  assert.strictEqual(profile.studentId, "20230001");
  assert.strictEqual(grades.grades.length, 1);
  assert.strictEqual(timetable.timetable.length, 1);
  assert.strictEqual(sync.status, "ok");
  console.log(JSON.stringify({ userDir: getUserPaths(userId).userDir, persisted: true }));
} else {
  const projectRoot = path.resolve(__dirname, "..");
  const dataDir = path.join(projectRoot, "test-data");
  assert.strictEqual(dataDir.startsWith(projectRoot + path.sep), true);
  fs.rmSync(dataDir, { recursive: true, force: true });

  const env = Object.assign({}, process.env, {
    NODE_ENV: "production",
    DATA_DIR: "test-data",
    CREDENTIAL_SECRET: "credential-secret-0123456789abcdef-extra",
    JWT_SECRET: "jwt-secret-0123456789abcdef012345-extra"
  });

  try {
    const write = spawnSync(process.execPath, [__filename, "write"], {
      cwd: projectRoot,
      env,
      encoding: "utf8"
    });
    assert.strictEqual(write.status, 0, write.stderr || write.stdout);
    const userDir = path.join(dataDir, "users", userId);
    assert.strictEqual(fs.existsSync(path.join(userDir, "profile.json")), true);
    assert.strictEqual(fs.existsSync(path.join(userDir, "grades.json")), true);
    assert.strictEqual(fs.existsSync(path.join(userDir, "timetable.json")), true);
    assert.strictEqual(fs.existsSync(path.join(userDir, "sync.json")), true);
    console.log("customDataDirWriteTest=passed");

    const read = spawnSync(process.execPath, [__filename, "read"], {
      cwd: projectRoot,
      env,
      encoding: "utf8"
    });
    assert.strictEqual(read.status, 0, read.stderr || read.stdout);
    assert.match(read.stdout, /"persisted":true/);
    console.log("nodeRestartPersistenceTest=passed");
    console.log("dataDirPath=" + path.join(dataDir, "users"));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
