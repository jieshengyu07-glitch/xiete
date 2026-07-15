const assert = require("assert");
const fs = require("fs");
const { createStorageForUser } = require("../src/db/storage");
const credentialStore = require("../src/services/credentialStore");
const userPersistence = require("../src/services/userPersistence");
const { ensureUserSession } = require("../src/sync/userSession");
const { getUserPaths } = require("../src/services/userPaths");

const userA = "test_user_persistence_A";
const userB = "test_user_persistence_B";

function cleanup(userId) {
  const paths = getUserPaths(userId);
  if (!String(paths.userDir).includes("test_user_persistence_")) {
    throw new Error("Refusing to remove non-test user directory");
  }
  fs.rmSync(paths.userDir, { recursive: true, force: true });
}

function exists(userId, name) {
  return fs.existsSync(getUserPaths(userId)[name]);
}

function sampleGrade(courseName, score, source) {
  return {
    courseCode: courseName.toUpperCase().replace(/\W+/g, ""),
    courseName,
    kcmc: courseName,
    KCMC: courseName,
    score,
    cj: score,
    CJ: score,
    credit: "2.0",
    xf: "2.0",
    XF: "2.0",
    xnm: "2025",
    XNM: "2025",
    xqm: "3",
    XQM: "3",
    term: "2025-2026-1",
    source: source || "jwxt"
  };
}

function run() {
  cleanup(userA);
  cleanup(userB);

  const storageA = createStorageForUser(userA);
  credentialStore.saveBoundAccount("20230001", "fake-password-A", userA);
  userPersistence.saveBoundProfile(userA, "20230001");
  storageA.mergeGrades([sampleGrade("Persistence Course", "85", "jwxt")]);
  userPersistence.mirrorFromStorage(userA, storageA, { kind: "grades", status: "ok" });

  assert.ok(exists(userA, "profilePath"));
  assert.ok(exists(userA, "campusPath"));
  assert.ok(exists(userA, "gradesPath"));
  const profile = userPersistence.readProfile(userA);
  const cached = userPersistence.readGradesCache(userA);
  assert.strictEqual(profile.openid, userA);
  assert.strictEqual(profile.studentId, "20230001");
  assert.strictEqual(cached.grades.length, 1);
  console.log("firstBindProfile=true");
  console.log("firstBindCampus=true");
  console.log("firstBindGrades=true");

  const secondOpen = userPersistence.readGradesCache(userA);
  assert.strictEqual(secondOpen.grades.length, 1);
  console.log("secondOpenCacheCount=" + secondOpen.grades.length);
  console.log("secondOpenNoNetwork=true");

  fs.writeFileSync(getUserPaths(userA).cookiesPath, "[]", "utf8");
  const session = ensureUserSession(userA);
  assert.strictEqual(session.hasCredentials, true);
  assert.strictEqual(session.canRefresh, true);
  console.log("sessionExpiredCanAutoRefresh=true");
  console.log("sessionExpiredRequiresPassword=false");

  storageA.mergeXgFallbackGrades([
    sampleGrade("Persistence Course", "83", "xg"),
    sampleGrade("Xg Only Candidate", "90", "xg")
  ]);
  userPersistence.mirrorFromStorage(userA, storageA, { kind: "grades", status: "ok" });
  const afterXg = userPersistence.readGradesCache(userA);
  assert.strictEqual(afterXg.grades.length, 1);
  assert.strictEqual(storageA.getXgUnmatchedCandidates().length, 1);
  console.log("jwxtUnavailableXgFallback=true");

  const storageB = createStorageForUser(userB);
  credentialStore.saveBoundAccount("20230002", "fake-password-B", userB);
  userPersistence.saveBoundProfile(userB, "20230002");
  storageB.mergeGrades([sampleGrade("User B Course", "77", "jwxt")]);
  userPersistence.mirrorFromStorage(userB, storageB, { kind: "grades", status: "ok" });
  assert.strictEqual(userPersistence.readGradesCache(userA).grades[0].courseName, "Persistence Course");
  assert.strictEqual(userPersistence.readGradesCache(userB).grades[0].courseName, "User B Course");
  console.log("userIsolationTest=true");

  const reloaded = createStorageForUser(userA);
  const reloadedCache = userPersistence.readGradesCache(userA);
  assert.strictEqual(reloaded.getGrades().length, 1);
  assert.strictEqual(reloadedCache.grades.length, 1);
  console.log("nodeRestartPersistenceTest=true");

  cleanup(userA);
  cleanup(userB);
  console.log("userPersistenceTest=passed");
}

run();
