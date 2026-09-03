const { runCycleForUser } = require("../checker");
const { createStorageForUser } = require("../db/storage");
const credentialRuntime = require("../services/credentialRuntime");
const legacyCredentialStore = require("../services/credentialStore");
const { isPostgresEnabled } = require("../db/pool");
const userPersistence = require("../services/userPersistence");
const { markCampusLoginValid } = require("../services/campusLoginState");
const { ensureUserSession } = require("./userSession");

const running = new Map();

function normalizeErrorCode(result) {
  return String((result && (result.error || result.cookieStatus)) || "SYNC_FAILED");
}

async function syncUserGrades(userId, options) {
  const storage = createStorageForUser(userId);
  userPersistence.initUserData(userId);
  try { const sessionProbe = ensureUserSession(userId); if (sessionProbe && typeof sessionProbe.catch === "function") sessionProbe.catch(() => {}); } catch (_) {}

  let credentials = null;
  try { credentials = isPostgresEnabled() ? await credentialRuntime.getJwxtCredentials(userId) : legacyCredentialStore.getJwxtCredentials(userId); } catch (_) {}
  if (!credentials) {
    const finishedAt = new Date().toISOString();
    userPersistence.updateSyncState(userId, {
      status: "failed",
      type: "grades",
      startedAt: finishedAt,
      finishedAt,
      errorCode: "LOGIN_REQUIRED",
      lastError: "LOGIN_REQUIRED"
    }, "grades");
    return {
      success: false,
      error: "LOGIN_REQUIRED",
      message: "No bound campus account"
    };
  }

  userPersistence.updateSyncState(userId, {
    status: "running",
    type: "grades",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    errorCode: "",
    lastError: ""
  }, "grades");

  try {
    const result = await runCycleForUser(userId, {
      skipJwxt: Boolean(options && options.skipJwxt)
    });
    if (result && result.success) {
      await markCampusLoginValid(userId, result.gradeSource || result.source || "grades");
      userPersistence.mirrorFromStorage(userId, storage, {
        kind: "grades",
        status: "success"
      });
      userPersistence.updateSyncState(userId, {
        status: "success",
        type: "grades",
        finishedAt: new Date().toISOString(),
        errorCode: "",
        lastError: ""
      }, "grades");
      return result;
    }

    const code = normalizeErrorCode(result);
    userPersistence.updateSyncState(userId, {
      status: "failed",
      type: "grades",
      finishedAt: new Date().toISOString(),
      errorCode: code,
      lastError: code
    }, "grades");
    userPersistence.saveCampusState(userId, storage);
    return result;
  } catch (err) {
    const code = String((err && err.code) || "SYNC_FAILED");
    userPersistence.updateSyncState(userId, {
      status: "failed",
      type: "grades",
      finishedAt: new Date().toISOString(),
      errorCode: code,
      lastError: code
    }, "grades");
    userPersistence.saveCampusState(userId, storage);
    if (options && options.throwOnError) throw err;
    return {
      success: false,
      error: code,
      message: err && err.message ? err.message : "sync failed"
    };
  }
}

function scheduleUserGradeSync(userId, reason, options) {
  if (!userId) return null;
  if (running.has(userId)) return running.get(userId);

  const task = syncUserGrades(userId, Object.assign({}, options || {}, { reason })).catch(err => {
    console.log("[user-sync] grade-sync-failed code=" + String((err && err.code) || "SYNC_FAILED"));
    return null;
  }).finally(() => {
    running.delete(userId);
  });

  running.set(userId, task);
  return task;
}

function isUserGradeSyncRunning(userId) {
  return Boolean(userId && running.has(userId));
}

module.exports = {
  syncUserGrades,
  scheduleUserGradeSync,
  isUserGradeSyncRunning
};
