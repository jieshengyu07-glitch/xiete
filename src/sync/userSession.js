const fs = require("fs");
const { getUserPaths } = require("../services/userPaths");
const credentialStore = require("../services/credentialStore");
const { createStorageForUser } = require("../db/storage");
const userPersistence = require("../services/userPersistence");

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
  const cookies = readJson(paths.cookiesPath, []);
  const xgSession = storage.getXgSession();
  const credentials = credentialStore.getJwxtCredentials(userId);
  const result = {
    userId,
    hasCredentials: Boolean(credentials),
    jwxtSessionValid: hasJwxtCookie(cookies),
    xgSessionValid: Boolean(xgSession && xgSession.scoreUrl && xgSession.cookies),
    canRefresh: Boolean(credentials)
  };
  userPersistence.saveCampusState(userId, storage);
  return result;
}

module.exports = {
  ensureUserSession
};
