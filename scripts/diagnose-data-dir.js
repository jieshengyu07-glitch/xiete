const fs = require("fs");
const path = require("path");

function resolveDataDir() {
  const configured = String(process.env.DATA_DIR || "").trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "development") {
    return path.resolve(__dirname, "..", "data");
  }
  const err = new Error("DATA_DIR is required");
  err.code = "DATA_DIR_REQUIRED";
  throw err;
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch (err) {
    return false;
  }
}

function inspectUserDirectory(userDir) {
  return {
    hasAccount: exists(path.join(userDir, "account.json")),
    hasCookies: exists(path.join(userDir, "cookies.json")),
    hasCampus: exists(path.join(userDir, "campus.json")),
    hasGrades: exists(path.join(userDir, "grades.json"))
  };
}

function diagnoseDataDir() {
  const dataDir = resolveDataDir();
  const usersDir = path.join(dataDir, "users");
  let userDirectories = [];

  if (exists(usersDir)) {
    userDirectories = fs.readdirSync(usersDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => inspectUserDirectory(path.join(usersDir, entry.name)));
  }

  return {
    dataDir,
    usersDirExists: exists(usersDir),
    userDirectoryCount: userDirectories.length,
    users: userDirectories,
    rootFiles: {
      "campus.json": exists(path.join(dataDir, "campus.json")),
      "cookies.json": exists(path.join(dataDir, "cookies.json")),
      "grades.json": exists(path.join(dataDir, "grades.json"))
    }
  };
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(diagnoseDataDir(), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({
      success: false,
      error: String(err && err.code || "DATA_DIAGNOSTIC_FAILED")
    }) + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  diagnoseDataDir,
  inspectUserDirectory,
  resolveDataDir
};
