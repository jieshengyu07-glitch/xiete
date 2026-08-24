const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-session-encryption-test-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = testDataDir;
process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-primary-0123456789-abcdef";

const { getUserPaths } = require("../src/services/userPaths");
const sessionStore = require("../src/services/campusSessionStore");
const sessionCrypto = require("../src/services/sessionCrypto");
const { JsonStorage } = require("../src/db/storage");

const userId = "phase2_session_encryption_user";
const paths = getUserPaths(userId);
const jwxtCookies = [
  { name: "route", value: "route-secret-value", domain: "newjwc.tyust.edu.cn", path: "/" },
  { name: "JSESSIONID", value: "jwxt-secret-session", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" },
  { name: "rememberMe", value: "remember-secret-value", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" }
];
const xgSession = {
  scoreUrl: "https://xg.tyust.edu.cn/StuStudentScore.aspx?id=test",
  cookies: "ASP.NET_SessionId=xg-secret-session; auth=xg-secret-auth",
  updatedAt: "2026-08-13T00:00:00.000Z"
};

function raw(file) {
  return fs.readFileSync(file, "utf8");
}

try {
  fs.rmSync(paths.userDir, { recursive: true, force: true });

  const missingKeyEnv = Object.assign({}, process.env, { NODE_ENV: "production" });
  delete missingKeyEnv.SESSION_ENCRYPTION_KEY;
  const missingKey = spawnSync(process.execPath, ["-e", [
    "try{require('./src/services/sessionCrypto').assertSessionEncryptionConfig();process.exit(2)}",
    "catch(e){if(e.code!=='SESSION_ENCRYPTION_UNAVAILABLE')process.exit(3)}"
  ].join("")], { cwd: path.resolve(__dirname, ".."), env: missingKeyEnv });
  assert.strictEqual(missingKey.status, 0);
  console.log("productionMissingSessionKeyFailsClosedTest=passed");

  sessionStore.writeCookies(jwxtCookies, userId);
  const encryptedJwxt = raw(paths.cookiesPath);
  assert.match(encryptedJwxt, /campus-secure-v1/);
  assert.strictEqual(encryptedJwxt.includes("jwxt-secret-session"), false);
  assert.strictEqual(encryptedJwxt.includes("remember-secret-value"), false);
  assert.deepStrictEqual(sessionStore.loadCookies(userId), jwxtCookies);
  console.log("jwxtEncryptedWriteAndReadTest=passed");

  fs.writeFileSync(paths.cookiesPath, JSON.stringify(jwxtCookies, null, 2), "utf8");
  assert.deepStrictEqual(sessionStore.loadCookies(userId), jwxtCookies);
  const migratedJwxt = raw(paths.cookiesPath);
  assert.match(migratedJwxt, /campus-secure-v1/);
  assert.strictEqual(migratedJwxt.includes("jwxt-secret-session"), false);
  assert.deepStrictEqual(sessionStore.loadCookies(userId), jwxtCookies);
  assert.strictEqual(raw(paths.cookiesPath), migratedJwxt);
  console.log("jwxtLegacyLazyMigrationAndSecondReadTest=passed");

  const corrupt = JSON.parse(migratedJwxt);
  corrupt.payload = corrupt.payload.slice(0, -4) + "AAAA";
  fs.writeFileSync(paths.cookiesPath, JSON.stringify(corrupt, null, 2), "utf8");
  assert.strictEqual(sessionStore.loadCookies(userId), null);
  assert.strictEqual(raw(paths.cookiesPath), JSON.stringify(corrupt, null, 2));
  console.log("corruptCiphertextRejectedTest=passed");

  sessionStore.writeCookies(jwxtCookies, userId);
  process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-wrong-0123456789-abcdefgh";
  sessionCrypto.resetSessionCryptoForTests();
  assert.strictEqual(sessionStore.loadCookies(userId), null);
  process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-primary-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  console.log("wrongKeyRejectedWithoutPlaintextFallbackTest=passed");

  fs.mkdirSync(paths.userDir, { recursive: true });
  fs.writeFileSync(paths.campusPath, JSON.stringify({
    grades: [{ courseName: "保留成绩", score: "90" }],
    timetable: [{ courseName: "保留课表" }],
    xgSession
  }, null, 2), "utf8");
  const storage = new JsonStorage(paths.campusPath, userId);
  assert.deepStrictEqual(storage.getXgSession(), xgSession);
  const migratedXg = raw(paths.campusPath);
  assert.match(migratedXg, /campus-secure-v1/);
  assert.strictEqual(migratedXg.includes("xg-secret-session"), false);
  assert.strictEqual(migratedXg.includes("ASP.NET_SessionId"), false);
  const secondStorage = new JsonStorage(paths.campusPath, userId);
  assert.deepStrictEqual(secondStorage.getXgSession(), xgSession);
  assert.strictEqual(raw(paths.campusPath), migratedXg);
  console.log("xgLegacyLazyMigrationAndExactRestoreTest=passed");

  process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-wrong-0123456789-abcdefgh";
  sessionCrypto.resetSessionCryptoForTests();
  const wrongKeyStorage = new JsonStorage(paths.campusPath, userId);
  assert.strictEqual(wrongKeyStorage.hasXgSession(), false);
  assert.throws(() => wrongKeyStorage.updateLastRun(), err => err && err.code === "SESSION_DECRYPT_FAILED");
  assert.strictEqual(raw(paths.campusPath), migratedXg);
  process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-primary-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  console.log("xgWrongKeyRejectedWithoutOverwriteTest=passed");

  secondStorage.clearXgSession();
  assert.strictEqual(secondStorage.hasXgSession(), false);
  assert.strictEqual(secondStorage.getGrades().length, 1);
  assert.strictEqual(secondStorage.data.timetable.length, 1);
  assert.strictEqual(raw(paths.campusPath).includes("xg-secret-session"), false);
  assert.strictEqual(fs.readdirSync(paths.userDir).some(name => name.includes(".tmp-")), false);
  console.log("xgClearPreservesCachesAndAtomicTempCleanupTest=passed");
} finally {
  process.env.SESSION_ENCRYPTION_KEY = "phase2-session-key-primary-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
