const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 2;
const failedAttempts = new Map();
const runningRecoveries = new Map();
const persistedUsers = new Set();

function persistedFailures(userId) {
  if (!userId) return [];
  try {
    const persistence = require("../services/userPersistence");
    const state = persistence.readSyncState(userId, "campus");
    return Array.isArray(state.recoveryFailures)
      ? state.recoveryFailures.map(Number).filter(Number.isFinite)
      : [];
  } catch (err) {
    return [];
  }
}

function savePersistedFailures(userId, values) {
  if (!userId) return;
  persistedUsers.add(String(userId));
  try {
    const persistence = require("../services/userPersistence");
    persistence.updateSyncState(userId, {
      recoveryFailures: Array.isArray(values) ? values : []
    }, "campus");
  } catch (err) {}
}

function recoveryKey(userId, kind) {
  return String(userId || "legacy") + ":" + String(kind || "campus");
}

function recentFailures(userId, now) {
  const key = String(userId || "legacy");
  const cutoff = now - RECOVERY_WINDOW_MS;
  const combined = (failedAttempts.get(key) || []).concat(persistedFailures(userId));
  const recent = Array.from(new Set(combined)).filter(at => at >= cutoff).sort((a, b) => a - b);
  if (recent.length) failedAttempts.set(key, recent);
  else failedAttempts.delete(key);
  savePersistedFailures(userId, recent);
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
    savePersistedFailures(userId, []);
    return { success: true, value };
  }).catch(err => {
    const failedAt = options && Number.isFinite(options.now) ? options.now : Date.now();
    const current = recentFailures(userId, failedAt);
    current.push(failedAt);
    failedAttempts.set(String(userId || "legacy"), current);
    savePersistedFailures(userId, current);
    return reloginRequired(err && err.code ? err.code : "SESSION_RECOVERY_FAILED");
  }).finally(() => {
    runningRecoveries.delete(key);
  });

  runningRecoveries.set(key, task);
  return task;
}

function resetRecoveryStateForTests() {
  persistedUsers.forEach(userId => savePersistedFailures(userId, []));
  persistedUsers.clear();
  failedAttempts.clear();
  runningRecoveries.clear();
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  recoverCampusSession,
  resetRecoveryStateForTests
};
