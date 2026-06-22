const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

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
      userDir: path.join(DATA_DIR, "users"),
      accountPath: path.join(DATA_DIR, "users", "account.json"),
      cookiesPath: path.join(DATA_DIR, "cookies.json"),
      campusPath: path.join(DATA_DIR, "campus.json")
    };
  }

  const userDir = path.join(DATA_DIR, "users", safe);
  return {
    userId: safe,
    userDir,
    accountPath: path.join(userDir, "account.json"),
    cookiesPath: path.join(userDir, "cookies.json"),
    campusPath: path.join(userDir, "campus.json")
  };
}

module.exports = {
  safeUserId,
  getUserPaths
};
