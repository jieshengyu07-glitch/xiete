const assert = require("assert");
const {
  bootstrapCampusSession,
  scheduleCampusSessionBootstrap
} = require("../src/sync/campusSessionBootstrap");

function dependencies(options) {
  const state = {
    recoverJwxtCalls: 0,
    ensureXgCalls: 0,
    statusUpdates: []
  };
  const deps = {
    credentialStore: {
      readBoundAccountMeta: () => ({ studentId: "present" }),
      getJwxtCredentials: () => ({ studentId: "present", password: "present" }),
      updateBoundAccountStatus: (userId, status) => state.statusUpdates.push(status)
    },
    userPersistence: {
      updateSyncState: (userId, patch) => state.statusUpdates.push(patch.status)
    },
    createStorageForUser: () => ({}),
    validateJwxt: async () => options.jwxtState,
    recoverJwxt: async () => {
      state.recoverJwxtCalls += 1;
      return options.jwxtRecovery;
    },
    ensureXgScoreSession: async () => {
      state.ensureXgCalls += 1;
      if (options.xgError) throw options.xgError;
      return { fromCache: options.xgFromCache !== false };
    },
    recoverCampusSession: async (userId, kind, action) => {
      try {
        const value = await action();
        return { success: true, value };
      } catch (err) {
        return { success: false, error: "ACCOUNT_RELOGIN_REQUIRED", causeCode: err.code };
      }
    }
  };
  return { deps, state };
}

async function main() {
  const automatic = dependencies({
    jwxtState: { valid: false, shouldRecover: true, error: "cookie_expired" },
    jwxtRecovery: [{ name: "restored" }],
    xgFromCache: false
  });
  const automaticResult = await bootstrapCampusSession("auto-user", automatic.deps);
  assert.strictEqual(automaticResult.success, true);
  assert.strictEqual(automatic.state.recoverJwxtCalls, 1);
  assert.strictEqual(automatic.state.ensureXgCalls, 1);
  assert(automatic.state.statusUpdates.includes("ready"));
  console.log("openMiniProgramAutoRecoverySuccessTest=passed");

  const valid = dependencies({
    jwxtState: { valid: true, shouldRecover: false, error: null },
    jwxtRecovery: null,
    xgFromCache: true
  });
  const validResult = await bootstrapCampusSession("valid-user", valid.deps);
  assert.strictEqual(validResult.success, true);
  assert.strictEqual(valid.state.recoverJwxtCalls, 0);
  assert.strictEqual(valid.state.ensureXgCalls, 1);
  console.log("validSessionNoRepeatedLoginTest=passed");

  const failed = dependencies({
    jwxtState: { valid: false, shouldRecover: true, error: "cookie_expired" },
    jwxtRecovery: { errorResult: { error: "ACCOUNT_RELOGIN_REQUIRED" } },
    xgError: Object.assign(new Error("expired"), { code: "XG_LOGIN_REQUIRED" })
  });
  const loginStartedAt = Date.now();
  const backgroundTask = scheduleCampusSessionBootstrap("failed-user", failed.deps);
  const loginElapsed = Date.now() - loginStartedAt;
  assert(loginElapsed < 50);
  const failedResult = await backgroundTask;
  assert.strictEqual(failedResult.error, "ACCOUNT_RELOGIN_REQUIRED");
  assert(failed.state.statusUpdates.includes("failed"));
  console.log("recoveryFailureDoesNotBlockWechatLoginTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
