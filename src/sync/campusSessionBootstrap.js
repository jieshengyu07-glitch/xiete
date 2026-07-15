const running = new Map();

const DEFINITIVE_AUTH_FAILURES = new Set([
  "INVALID_CREDENTIALS",
  "JWXT_INVALID_CREDENTIALS",
  "ACCOUNT_INVALID_CREDENTIALS",
  "CREDENTIALS_UNAVAILABLE"
]);

function isDefinitiveAuthFailure(code) {
  return DEFINITIVE_AUTH_FAILURES.has(String(code || "").toUpperCase());
}

function recoveringResult(causeCode, retryAfterSeconds) {
  return {
    success: false,
    recovering: true,
    error: String(causeCode || "SESSION_RECOVERY_PENDING"),
    causeCode: String(causeCode || "SESSION_RECOVERY_PENDING"),
    retryAfterSeconds: retryAfterSeconds || 60,
    message: "账号已绑定，教务系统暂时不可用，将自动恢复"
  };
}

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
    const failedAt = new Date().toISOString();
    deps.credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
      lastFailedSyncAt: failedAt,
      lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
      lastJwxtErrorMessage: "校园账号登录已过期，请重新绑定",
      xgStatus: "LOGIN_REQUIRED"
    });
    deps.userPersistence.updateSyncState(userId, {
      status: "failed",
      finishedAt: failedAt,
      errorCode: "ACCOUNT_RELOGIN_REQUIRED",
      lastError: "ACCOUNT_RELOGIN_REQUIRED"
    }, "campus");
    return reloginResult("CREDENTIALS_UNAVAILABLE");
  }

  const storage = deps.createStorageForUser(userId);
  let jwxtReady = false;
  let xgReady = false;
  let lastCause = "SESSION_RECOVERY_FAILED";
  const causes = [];
  let retryAfterSeconds = 60;

  const jwxtState = await deps.validateJwxt(userId);
  if (jwxtState && jwxtState.valid) {
    jwxtReady = true;
  } else if (jwxtState && jwxtState.shouldRecover) {
    const recovered = await deps.recoverJwxt(userId);
    if (recovered && !recovered.errorResult) jwxtReady = true;
    else {
      lastCause = String(recovered && recovered.errorResult && (recovered.errorResult.causeCode || recovered.errorResult.error) || "JWXT_RECOVERY_FAILED");
      causes.push(lastCause);
      retryAfterSeconds = Number(recovered && recovered.errorResult && recovered.errorResult.retryAfterSeconds) || retryAfterSeconds;
    }
  } else if (jwxtState && jwxtState.error) {
    lastCause = String(jwxtState.error);
    causes.push(lastCause);
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
    causes.push(lastCause);
    retryAfterSeconds = Number(xgRecovery.retryAfterSeconds) || retryAfterSeconds;
  }

  if (jwxtReady || xgReady) {
    const recoveredAt = new Date().toISOString();
    const statusExtra = {
      lastSuccessfulSyncAt: recoveredAt,
      ...(jwxtReady ? { lastJwxtError: null, lastJwxtErrorMessage: null } : {}),
      ...(xgReady
        ? { xgStatus: "OK", lastXgSuccessfulAt: recoveredAt }
        : { xgStatus: "UNAVAILABLE" })
    };
    deps.credentialStore.updateBoundAccountStatus(userId, jwxtReady ? "OK" : null, statusExtra);
    deps.userPersistence.updateSyncState(userId, {
      status: "ready",
      finishedAt: recoveredAt,
      lastSuccessfulAt: recoveredAt,
      lastError: "",
      errorCode: "",
      source: jwxtReady && xgReady ? "jwxt+xg" : (jwxtReady ? "jwxt" : "xg")
    }, "campus");
    return { success: true, jwxtReady, xgReady };
  }

  const definitiveCause = causes.find(isDefinitiveAuthFailure);
  const failedAt = new Date().toISOString();
  if (!definitiveCause) {
    const retrySeconds = Math.max(30, retryAfterSeconds || 60);
    deps.credentialStore.updateBoundAccountStatus(userId, "UNAVAILABLE", {
      lastFailedSyncAt: failedAt,
      lastJwxtError: lastCause,
      lastJwxtErrorMessage: "教务系统暂时不可用，将自动恢复",
      xgStatus: "UNAVAILABLE"
    });
    deps.userPersistence.updateSyncState(userId, {
      status: "recovering",
      finishedAt: failedAt,
      lastAttemptAt: failedAt,
      nextRetryAt: new Date(Date.now() + retrySeconds * 1000).toISOString(),
      retryAfterSeconds: retrySeconds,
      errorCode: lastCause,
      lastError: lastCause
    }, "campus");
    return recoveringResult(lastCause, retrySeconds);
  }

  deps.credentialStore.updateBoundAccountStatus(userId, "LOGIN_FAILED", {
    lastFailedSyncAt: failedAt,
    lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED",
    lastJwxtErrorMessage: "校园账号登录已过期，请重新绑定",
    xgStatus: "LOGIN_REQUIRED"
  });
  deps.userPersistence.updateSyncState(userId, {
    status: "failed",
    finishedAt: failedAt,
    errorCode: "ACCOUNT_RELOGIN_REQUIRED",
    lastError: "ACCOUNT_RELOGIN_REQUIRED"
  }, "campus");
  return reloginResult(definitiveCause);
}

function scheduleCampusSessionBootstrap(userId, overrides) {
  if (!userId) return null;
  if (running.has(userId)) return running.get(userId);

  const deps = overrides && overrides.userPersistence
    ? overrides
    : defaultDependencies();
  deps.userPersistence.updateSyncState(userId, {
    status: "recovering",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    errorCode: "",
    lastError: ""
  }, "campus");

  const task = new Promise(resolve => {
    setImmediate(resolve);
  }).then(() => bootstrapCampusSession(userId, overrides)).catch(err => {
    const causeCode = String((err && err.code) || "SESSION_BOOTSTRAP_FAILED");
    const failedAt = new Date().toISOString();
    console.log("[campus-session] bootstrap failed code=" + causeCode);
    try {
      const definitive = isDefinitiveAuthFailure(causeCode);
      deps.credentialStore.updateBoundAccountStatus(userId, definitive ? "LOGIN_FAILED" : "UNAVAILABLE", {
        lastFailedSyncAt: failedAt,
        lastJwxtError: definitive ? "ACCOUNT_RELOGIN_REQUIRED" : causeCode,
        lastJwxtErrorMessage: definitive ? "校园账号登录已过期，请重新绑定" : "教务系统暂时不可用，将自动恢复",
        xgStatus: definitive ? "LOGIN_REQUIRED" : "UNAVAILABLE"
      });
      deps.userPersistence.updateSyncState(userId, {
        status: definitive ? "failed" : "recovering",
        finishedAt: failedAt,
        nextRetryAt: definitive ? "" : new Date(Date.now() + 60 * 1000).toISOString(),
        errorCode: definitive ? "ACCOUNT_RELOGIN_REQUIRED" : causeCode,
        lastError: definitive ? "ACCOUNT_RELOGIN_REQUIRED" : causeCode,
        causeCode
      }, "campus");
    } catch (stateErr) {}
    return isDefinitiveAuthFailure(causeCode)
      ? reloginResult(causeCode)
      : recoveringResult(causeCode, 60);
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
