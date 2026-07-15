const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { userIdHash } = require("../utils/userIdHash");

const ADMIN_HEADER = "x-admin-diagnostic-key";
const MIN_ADMIN_SECRET_LENGTH = 32;
const EXAMPLE_ADMIN_SECRETS = new Set([
  "set_a_unique_random_value_of_at_least_32_characters",
  "change_me_to_a_long_random_admin_secret"
]);

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch (err) {
    return false;
  }
}

function inspectUserDirectory(userDir) {
  return {
    hasAccount: fileExists(path.join(userDir, "account.json")),
    hasCookies: fileExists(path.join(userDir, "cookies.json")),
    hasCampus: fileExists(path.join(userDir, "campus.json")),
    hasGrades: fileExists(path.join(userDir, "grades.json")),
    hasTimetable: fileExists(path.join(userDir, "timetable.json"))
  };
}

function diagnoseDataDirectory(dataDir) {
  const resolvedDataDir = path.resolve(dataDir);
  const usersDir = path.join(resolvedDataDir, "users");
  let users = [];

  if (fileExists(usersDir)) {
    users = fs.readdirSync(usersDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => Object.assign(
        { userIdHash: userIdHash(entry.name) },
        inspectUserDirectory(path.join(usersDir, entry.name))
      ));
  }

  return {
    dataDir: resolvedDataDir,
    usersCount: users.length,
    users,
    rootFiles: {
      campus: fileExists(path.join(resolvedDataDir, "campus.json")),
      cookies: fileExists(path.join(resolvedDataDir, "cookies.json")),
      grades: fileExists(path.join(resolvedDataDir, "grades.json"))
    }
  };
}

function configuredAdminSecret() {
  const secret = String(process.env.ADMIN_DIAGNOSTIC_SECRET || "").trim();
  if (secret.length < MIN_ADMIN_SECRET_LENGTH) return "";
  if (EXAMPLE_ADMIN_SECRETS.has(secret.toLowerCase())) return "";
  if (secret === String(process.env.JWT_SECRET || "").trim()) return "";
  if (secret === String(process.env.CREDENTIAL_SECRET || "").trim()) return "";
  return secret;
}

function isDiagnosticAdminAuthorized(candidate) {
  const expected = configuredAdminSecret();
  if (!expected) return { enabled: false, authorized: false };

  const supplied = String(candidate || "");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const authorized = expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  return { enabled: true, authorized };
}

module.exports = {
  ADMIN_HEADER,
  diagnoseDataDirectory,
  inspectUserDirectory,
  isDiagnosticAdminAuthorized
};
