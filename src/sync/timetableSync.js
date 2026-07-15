const { createStorageForUser } = require("../db/storage");
const credentialStore = require("../services/credentialStore");
const userPersistence = require("../services/userPersistence");
const { loadConfiguredTerm } = require("../timetable/calendar");
const { syncTimetableForUser } = require("../timetable/sync");

const running = new Map();

async function syncUserTimetable(userId) {
  const storage = createStorageForUser(userId);
  userPersistence.initUserData(userId);
  userPersistence.updateSyncState(userId, {
    status: "running", type: "timetable", startedAt: new Date().toISOString(),
    finishedAt: "", errorCode: "", lastError: ""
  }, "timetable");
  try {
    const result = await syncTimetableForUser(userId, storage, { term: loadConfiguredTerm() });
    if (result && result.success) {
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
