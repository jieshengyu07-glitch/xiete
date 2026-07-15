const path = require("path");

const config = require("../config");

function safeUserId(userId) {
  const safe = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return "";
  return safe;
}

function getUserPaths(userId) {
  const safe = safeUserId(userId);
  if (!safe) {
    return {
      userId: "",
      userDir: path.join(config.dataDir, "users"),
      accountPath: path.join(config.dataDir, "users", "account.json"),
      cookiesPath: path.join(config.dataDir, "cookies.json"),
      campusPath: path.join(config.dataDir, "campus.json"),
      profilePath: path.join(config.dataDir, "users", "profile.json"),
      gradesPath: path.join(config.dataDir, "users", "grades.json"),
      timetablePath: path.join(config.dataDir, "users", "timetable.json"),
      syncPath: path.join(config.dataDir, "users", "sync.json")
    };
  }

  const userDir = path.join(config.dataDir, "users", safe);
  return {
    userId: safe,
    userDir,
    accountPath: path.join(userDir, "account.json"),
    cookiesPath: path.join(userDir, "cookies.json"),
    campusPath: path.join(userDir, "campus.json"),
    profilePath: path.join(userDir, "profile.json"),
    gradesPath: path.join(userDir, "grades.json"),
    timetablePath: path.join(userDir, "timetable.json"),
    syncPath: path.join(userDir, "sync.json")
  };
}

module.exports = {
  safeUserId,
  getUserPaths
};
