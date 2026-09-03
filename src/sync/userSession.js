const fs = require("fs");
const { getUserPaths } = require("../services/userPaths");
const credentialRuntime = require("../services/credentialRuntime");
const { createStorageForUser } = require("../db/storage");
const userPersistence = require("../services/userPersistence");
const campusSessionStore = require("../services/campusSessionStore");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function hasJwxtCookie(cookies) {
  return (Array.isArray(cookies) ? cookies : []).some(cookie =>
    cookie &&
    cookie.name === "JSESSIONID" &&
    String(cookie.domain || "").includes("newjwc.tyust.edu.cn")
  );
}

function ensureUserSession(userId) {
  const paths = userPersistence.initUserData(userId);
  const storage = createStorageForUser(userId);
  const cookies = campusSessionStore.loadCookies(userId) || [];
  const xgSession = storage.getXgSession();
  if (require("../db/pool").isPostgresEnabled()) return ensureUserSessionAsync(userId);
  const legacyStore = require("../services/credentialStore");
  const localCredentials = legacyStore.getJwxtCredentials(userId);
  const result = {
    userId,
    hasCredentials: Boolean(localCredentials),
    jwxtSessionValid: hasJwxtCookie(cookies),
    xgSessionValid: Boolean(xgSession && xgSession.scoreUrl && xgSession.cookies),
    canRefresh: Boolean(localCredentials)
  };
  try { userPersistence.saveCampusState(userId, storage); } catch (_) {}
  return result;
}

async function ensureUserSessionAsync(userId) {
  const paths = userPersistence.initUserData(userId);
  const storage = createStorageForUser(userId);
  const cookies = campusSessionStore.loadCookies(userId) || [];
  const xgSession = storage.getXgSession();
  let credentials = null;
  try { credentials = await credentialRuntime.getJwxtCredentials(userId); } catch (_) {}
  return { userId, hasCredentials: Boolean(credentials), jwxtSessionValid: hasJwxtCookie(cookies), xgSessionValid: Boolean(xgSession && xgSession.scoreUrl && xgSession.cookies), canRefresh: Boolean(credentials) };
}

module.exports = {
  ensureUserSession
};
