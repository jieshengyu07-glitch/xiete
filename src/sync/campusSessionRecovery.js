const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 2;
const failedAttempts = new Map();
const runningRecoveries = new Map();
const persistedScopes = new Map();

function persistedFailures(userId, kind) {
  if (!userId) return [];
  try {
    const persistence = require("../services/userPersistence");
    const state = persistence.readSyncState(userId, "campus");
    const byKind = state && state.recoveryFailuresByKind;
    if (byKind && Array.isArray(byKind[kind])) {
      return byKind[kind].map(Number).filter(Number.isFinite);
    }
    // Legacy releases stored one shared list. Treat it as JWXT history only so
    // a JWXT outage cannot prevent the independent XG fallback from running.
    return kind === "jwxt" && Array.isArray(state.recoveryFailures)
      ? state.recoveryFailures.map(Number).filter(Number.isFinite)
      : [];
  } catch (err) {
    return [];
  }
}

function savePersistedFailures(userId, kind, values) {
  if (!userId) return;
  const scope = recoveryKey(userId, kind);
  persistedScopes.set(scope, { userId: String(userId), kind: String(kind || "campus") });
  try {
    const persistence = require("../services/userPersistence");
    const state = persistence.readSyncState(userId, "campus");
    const byKind = Object.assign({}, state && state.recoveryFailuresByKind);
    if (!Object.keys(byKind).length && kind !== "jwxt" && Array.isArray(state && state.recoveryFailures)) {
      byKind.jwxt = state.recoveryFailures.map(Number).filter(Number.isFinite);
    }
    byKind[kind] = Array.isArray(values) ? values : [];
    const combined = Object.keys(byKind)
      .reduce((all, channel) => all.concat(Array.isArray(byKind[channel]) ? byKind[channel] : []), [])
      .map(Number)
      .filter(Number.isFinite);
    persistence.updateSyncState(userId, {
      recoveryFailuresByKind: byKind,
      recoveryFailures: Array.from(new Set(combined)).sort((a, b) => a - b)
    }, "campus");
  } catch (err) {}
}

function recoveryKey(userId, kind) {
  return String(userId || "legacy") + ":" + String(kind || "campus");
}

function recentFailures(userId, kind, now) {
  const key = recoveryKey(userId, kind);
  const cutoff = now - RECOVERY_WINDOW_MS;
  const combined = (failedAttempts.get(key) || []).concat(persistedFailures(userId, kind));
  const recent = Array.from(new Set(combined)).filter(at => at >= cutoff).sort((a, b) => a - b);
  if (recent.length) failedAttempts.set(key, recent);
  else failedAttempts.delete(key);
  savePersistedFailures(userId, kind, recent);
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
  const channel = String(kind || "campus");
  const failures = recentFailures(userId, channel, now);
  if (failures.length >= MAX_FAILED_ATTEMPTS) {
    const retryAt = failures[0] + RECOVERY_WINDOW_MS;
    return reloginRequired("ACCOUNT_RECOVERY_RATE_LIMITED", Math.max(1, Math.ceil((retryAt - now) / 1000)));
  }

  const key = recoveryKey(userId, channel);
  if (runningRecoveries.has(key)) return runningRecoveries.get(key);

  const task = Promise.resolve().then(recover).then(value => {
    failedAttempts.delete(key);
    savePersistedFailures(userId, channel, []);
    return { success: true, value };
  }).catch(err => {
    const failedAt = options && Number.isFinite(options.now) ? options.now : Date.now();
    const current = recentFailures(userId, channel, failedAt);
    current.push(failedAt);
    failedAttempts.set(key, current);
    savePersistedFailures(userId, channel, current);
    return reloginRequired(err && err.code ? err.code : "SESSION_RECOVERY_FAILED");
  }).finally(() => {
    runningRecoveries.delete(key);
  });

  runningRecoveries.set(key, task);
  return task;
}

function resetRecoveryStateForTests() {
  persistedScopes.forEach(scope => savePersistedFailures(scope.userId, scope.kind, []));
  persistedScopes.clear();
  failedAttempts.clear();
  runningRecoveries.clear();
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  RECOVERY_WINDOW_MS,
  recoverCampusSession,
  resetRecoveryStateForTests
};
