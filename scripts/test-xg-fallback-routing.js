const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xg-fallback-routing-"));
process.env.DATA_DIR = dataDir;

const storagePath = require.resolve("../src/db/storage");
const credentialsPath = require.resolve("../src/services/credentialStore");
const jwxtLoginPath = require.resolve("../src/login/httpJwxtLogin");
const xgSessionPath = require.resolve("../src/grade/xgSession");
const xgQueryPath = require.resolve("../src/grade/xgScoreQuery");
const recoveryPath = require.resolve("../src/sync/campusSessionRecovery");
const checkerPath = require.resolve("../src/checker");

let xgEnsured = 0;
let xgMerged = 0;
const userStorage = {
  mergeXgFallbackGrades(grades) {
    xgMerged += 1;
    assert.strictEqual(grades.length, 1);
    return { stats: { matched: 0, candidates: 0, final: 1 } };
  },
  updateLastRun() {}
};

require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: Object.assign({}, userStorage, {
    createStorageForUser: () => userStorage
  })
};
require.cache[credentialsPath] = {
  id: credentialsPath,
  filename: credentialsPath,
  loaded: true,
  exports: {
    getJwxtCredentials: () => ({ studentId: "student", password: "encrypted-test-value" }),
    hasBoundAccount: () => true,
    updateBoundAccountStatus: () => true
  }
};
require.cache[jwxtLoginPath] = {
  id: jwxtLoginPath,
  filename: jwxtLoginPath,
  loaded: true,
  exports: { httpJwxtLogin: async () => { throw new Error("must not run during cooldown"); } }
};
require.cache[xgSessionPath] = {
  id: xgSessionPath,
  filename: xgSessionPath,
  loaded: true,
  exports: {
    ensureXgScoreSession: async () => {
      xgEnsured += 1;
      return {
        fromCache: true,
        grades: [{ courseName: "XG fallback course", score: "88", credit: "2", term: "2025-2026学年第1学期" }]
      };
    }
  }
};
require.cache[xgQueryPath] = {
  id: xgQueryPath,
  filename: xgQueryPath,
  loaded: true,
  exports: { queryXgScores: async () => { throw new Error("session grades should be used"); } }
};
require.cache[recoveryPath] = {
  id: recoveryPath,
  filename: recoveryPath,
  loaded: true,
  exports: {
    recoverCampusSession: async (userId, kind, recover) => ({ success: true, value: await recover() })
  }
};

async function main() {
  delete require.cache[checkerPath];
  const checker = require(checkerPath);
  const result = await checker.runCycleForUser("xg-fallback-user", { skipJwxt: true });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.gradeSource, "xg");
  assert.strictEqual(result.gradesCount, 1);
  assert.strictEqual(xgEnsured, 1);
  assert.strictEqual(xgMerged, 1);
  console.log("jwxtCooldownRoutesDirectlyToXgTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
