const running = new Map();

function defaultDependencies() {
  const checker = require("../checker");
  const credentialStore = require("../services/credentialStore");
  const userPersistence = require("../services/userPersistence");
  const { createStorageForUser } = require("../db/storage");
  const { ensureXgScoreSession } = require("../grade/xgSession");
  const { recoverCampusSession } = require("./campusSessionRecovery");
  return {
    credentialStore,
    userPersistence,
    createStorageForUser,
    validateJwxt: checker.validateJwxtSessionForUser,
    recoverJwxt: checker.refreshCookiesFromEnv,
    ensureXgScoreSession,
    recoverCampusSession
  };
}

function reloginResult(causeCode) {
  return {
    success: false,
    error: "ACCOUNT_RELOGIN_REQUIRED",
    causeCode: String(causeCode || "SESSION_RECOVERY_FAILED"),
    message: "校园账号登录已过期，请重新绑定"
  };
}

async function bootstrapCampusSession(userId, overrides) {
  const deps = overrides && overrides.credentialStore
    ? overrides
    : Object.assign(defaultDependencies(), overrides || {});
  const accountMeta = deps.credentialStore.readBoundAccountMeta(userId);
  if (!accountMeta) return { success: true, skipped: true, reason: "NO_CAMPUS_ACCOUNT" };

  const credentials = deps.credentialStore.getJwxtCredentials(userId);
  if (!credentials) {
    deps.credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
      lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
      lastJwxtErrorMessage: "校园账号登录已过期，请重新绑定"
    });
    deps.userPersistence.updateSyncState(userId, { status: "failed", lastError: "ACCOUNT_RELOGIN_REQUIRED" }, "campus");
    return reloginResult("CREDENTIALS_UNAVAILABLE");
  }

  const storage = deps.createStorageForUser(userId);
  let jwxtReady = false;
  let xgReady = false;
  let lastCause = "SESSION_RECOVERY_FAILED";

  const jwxtState = await deps.validateJwxt(userId);
  if (jwxtState && jwxtState.valid) {
    jwxtReady = true;
  } else if (jwxtState && jwxtState.shouldRecover) {
    const recovered = await deps.recoverJwxt(userId);
    if (recovered && !recovered.errorResult) jwxtReady = true;
    else lastCause = String(recovered && recovered.errorResult && (recovered.errorResult.causeCode || recovered.errorResult.error) || "JWXT_RECOVERY_FAILED");
  } else if (jwxtState && jwxtState.error) {
    lastCause = String(jwxtState.error);
  }

  const xgRecovery = await deps.recoverCampusSession(
    userId,
    "xg",
    () => deps.ensureXgScoreSession(userId, storage)
  );
  if (xgRecovery && xgRecovery.success) {
    xgReady = true;
  } else if (xgRecovery) {
    lastCause = String(xgRecovery.causeCode || xgRecovery.error || lastCause);
  }

  if (jwxtReady || xgReady) {
    deps.credentialStore.updateBoundAccountStatus(userId, "OK", {
      lastJwxtError: null,
      lastJwxtErrorMessage: null
    });
    deps.userPersistence.updateSyncState(userId, { status: "ready", lastError: "" }, "campus");
    return { success: true, jwxtReady, xgReady };
  }

  deps.credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
    lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
    lastJwxtErrorMessage: "校园账号登录已过期，请重新绑定"
  });
  deps.userPersistence.updateSyncState(userId, { status: "failed", lastError: "ACCOUNT_RELOGIN_REQUIRED" }, "campus");
  return reloginResult(lastCause);
}

function scheduleCampusSessionBootstrap(userId, overrides) {
  if (!userId) return null;
  if (running.has(userId)) return running.get(userId);

  const task = new Promise(resolve => {
    setImmediate(resolve);
  }).then(() => bootstrapCampusSession(userId, overrides)).catch(err => {
    console.log("[campus-session] bootstrap failed code=" + String((err && err.code) || "SESSION_BOOTSTRAP_FAILED"));
    return reloginResult(err && err.code);
  }).finally(() => {
    running.delete(userId);
  });

  running.set(userId, task);
  return task;
}

function isCampusSessionBootstrapRunning(userId) {
  return Boolean(userId && running.has(userId));
}

module.exports = {
  bootstrapCampusSession,
  scheduleCampusSessionBootstrap,
  isCampusSessionBootstrapRunning
};
