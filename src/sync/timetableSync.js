const { createStorageForUser } = require("../db/storage");
const userPersistence = require("../services/userPersistence");
const { markCampusLoginValid } = require("../services/campusLoginState");
const { loadConfiguredTerm } = require("../timetable/calendar");
const { syncTimetableForUser } = require("../timetable/sync");
const campusCacheRuntime = require("../services/campusCacheRuntime");
const syncStateRuntime = require("../services/syncStateRuntime");

const running = new Map();

async function syncUserTimetable(userId) {
  try { await syncStateRuntime.update(userId, "timetable", { lastAttemptAt: new Date().toISOString() }); } catch (_) {}
  const storage = createStorageForUser(userId);
  userPersistence.initUserData(userId);
  userPersistence.updateSyncState(userId, {
    status: "running", type: "timetable", startedAt: new Date().toISOString(),
    finishedAt: "", errorCode: "", lastError: ""
  }, "timetable");
  try {
    const result = await syncTimetableForUser(userId, storage, { term: loadConfiguredTerm() });
    if (result && result.success) {
      try { if (require("../db/pool").isPostgresEnabled()) await campusCacheRuntime.saveTimetable(userId, storage.getTimetable(loadConfiguredTerm().termYear, loadConfiguredTerm().termSemester), result.updatedAt); }
      catch (cacheErr) { console.error("[cache] timetable persistence failed code=" + (cacheErr.code || "CACHE_WRITE_FAILED")); try { await syncStateRuntime.update(userId, "timetable", { lastError: "CACHE_PERSISTENCE_FAILED" }); } catch (_) {} return { success: false, error: "CACHE_PERSISTENCE_FAILED", message: "课表缓存持久化失败" }; }
      if (require("../db/pool").isPostgresEnabled()) await syncStateRuntime.update(userId, "timetable", { lastSuccessfulAt: result.updatedAt, lastError: "" });
      await markCampusLoginValid(userId, "timetable");
      userPersistence.mirrorFromStorage(userId, storage, { kind: "timetable", status: "success" });
      userPersistence.updateSyncState(userId, {
        status: "success", type: "timetable", finishedAt: new Date().toISOString(), errorCode: "", lastError: ""
      }, "timetable");
      return result;
    }
    const code = String((result && result.error) || "TIMETABLE_SYNC_FAILED");
    userPersistence.updateSyncState(userId, {
      status: "failed", type: "timetable", finishedAt: new Date().toISOString(), errorCode: code, lastError: code
    }, "timetable");
    try { await syncStateRuntime.update(userId, "timetable", { lastError: code }); } catch (_) {}
    return result;
  } catch (err) {
    const code = String((err && err.code) || "TIMETABLE_SYNC_FAILED");
    userPersistence.updateSyncState(userId, {
      status: "failed", type: "timetable", finishedAt: new Date().toISOString(), errorCode: code, lastError: code
    }, "timetable");
    return { success: false, error: code, message: err && err.message ? err.message : "timetable sync failed" };
  }
}

function scheduleUserTimetableSync(userId) {
  if (!userId) return null;
  if (running.has(userId)) return running.get(userId);
  const task = syncUserTimetable(userId).finally(() => running.delete(userId));
  running.set(userId, task);
  return task;
}

function isUserTimetableSyncRunning(userId) {
  return Boolean(userId && running.has(userId));
}

module.exports = { syncUserTimetable, scheduleUserTimetableSync, isUserTimetableSyncRunning };
