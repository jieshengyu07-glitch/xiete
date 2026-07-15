const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 2;
const failedAttempts = new Map();
const runningRecoveries = new Map();

function recoveryKey(userId, kind) {
  return String(userId || "legacy") + ":" + String(kind || "campus");
}

function recentFailures(userId, now) {
  const key = String(userId || "legacy");
  const cutoff = now - RECOVERY_WINDOW_MS;
  const recent = (failedAttempts.get(key) || []).filter(at => at >= cutoff);
  if (recent.length) failedAttempts.set(key, recent);
  else failedAttempts.delete(key);
  return recent;
}

function reloginRequired(causeCode, retryAfterSeconds) {
  return {
    success: false,
    error: "ACCOUNT_RELOGIN_REQUIRED",
    causeCode: String(causeCode || "SESSION_RECOVERY_FAILED"),
    message: "校园账号登录已过期，请重新绑定",
    retryAfterSeconds: retryAfterSeconds || null
  };
}

async function recoverCampusSession(userId, kind, recover, options) {
  if (typeof recover !== "function") {
    throw new TypeError("recover must be a function");
  }

  const now = options && Number.isFinite(options.now) ? options.now : Date.now();
  const failures = recentFailures(userId, now);
  if (failures.length >= MAX_FAILED_ATTEMPTS) {
    const retryAt = failures[0] + RECOVERY_WINDOW_MS;
    return reloginRequired("ACCOUNT_RECOVERY_RATE_LIMITED", Math.max(1, Math.ceil((retryAt - now) / 1000)));
  }

  const key = recoveryKey(userId, kind);
  if (runningRecoveries.has(key)) return runningRecoveries.get(key);

  const task = Promise.resolve().then(recover).then(value => {
    failedAttempts.delete(String(userId || "legacy"));
    return { success: true, value };
  }).catch(err => {
    const failedAt = options && Number.isFinite(options.now) ? options.now : Date.now();
    const current = recentFailures(userId, failedAt);
    current.push(failedAt);
    failedAttempts.set(String(userId || "legacy"), current);
    return reloginRequired(err && err.code ? err.code : "SESSION_RECOVERY_FAILED");
  }).finally(() => {
    runningRecoveries.delete(key);
  });

  runningRecoveries.set(key, task);
  return task;
}

function resetRecoveryStateForTests() {
  failedAttempts.clear();
  runningRecoveries.clear();
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  recoverCampusSession,
  resetRecoveryStateForTests
};
