const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xg-baseline-"));
const previous = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATA_DIR: process.env.DATA_DIR
};
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://test-only";
process.env.DATA_DIR = dataDir;

const storagePath = require.resolve("../src/db/storage");
const credentialsPath = require.resolve("../src/services/credentialStore");
const runtimePath = require.resolve("../src/services/campusCacheRuntime");
const loginPath = require.resolve("../src/login/httpJwxtLogin");
const xgSessionPath = require.resolve("../src/grade/xgSession");
const xgQueryPath = require.resolve("../src/grade/xgScoreQuery");
const recoveryPath = require.resolve("../src/sync/campusSessionRecovery");
const checkerPath = require.resolve("../src/checker");

const jwxtBaseline = Array.from({ length: 60 }, (_, i) => ({
  courseCode: "JWXT-" + i,
  courseName: "JWXT course " + i,
  term: "2025-2026-1",
  score: "90",
  credit: "2",
  source: "jwxt"
}));
let hydrated = false;
let mergedCount = 0;

const userStorage = {
  data: { grades: [] },
  getGrades() { return this.data.grades; },
  mergeXgFallbackGrades(incoming) {
    mergedCount = this.data.grades.length;
    assert.strictEqual(mergedCount, 60);
    assert.strictEqual(incoming.length, 50);
    hydrated = true;
    return { stats: { matched: 50, candidates: 0, final: 60 } };
  },
  updateLastRun() {}
};

function stub(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
}

stub(storagePath, { createStorageForUser: () => userStorage });
stub(credentialsPath, { getJwxtCredentials: () => ({ studentId: "test", password: "test" }) });
stub(runtimePath, { getGrades: async () => ({ grades: jwxtBaseline, updatedAt: "" }) });
stub(loginPath, { httpJwxtLogin: async () => { throw new Error("not expected"); } });
stub(xgSessionPath, { ensureXgScoreSession: async () => ({ fromCache: true, grades: Array.from({ length: 50 }, (_, i) => ({ courseName: "XG " + i })) }) });
stub(xgQueryPath, { queryXgScores: async () => [] });
stub(recoveryPath, { recoverCampusSession: async (userId, kind, recover) => ({ success: true, value: await recover() }) });

async function main() {
  delete require.cache[checkerPath];
  const checker = require(checkerPath);
  const result = await checker.runCycleForUser("test-user", { skipJwxt: true });
  assert.strictEqual(result.success, true);
  assert.strictEqual(hydrated, true);
  assert.strictEqual(mergedCount, 60);
  console.log("postgresBaselineHydrationPreservesJwxtTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
}).finally(() => {
  for (const key of [storagePath, credentialsPath, runtimePath, loginPath, xgSessionPath, xgQueryPath, recoveryPath, checkerPath]) delete require.cache[key];
  if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.NODE_ENV;
  if (previous.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.DATABASE_URL;
  if (previous.DATA_DIR === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
