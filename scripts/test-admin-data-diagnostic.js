const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  diagnoseDataDirectory,
  isDiagnosticAdminAuthorized
} = require("../src/services/dataDirectoryDiagnostic");

const dataDir = path.resolve(__dirname, "..", "test-admin-diagnostic-data");
const adminSecret = "admin-diagnostic-secret-0123456789abcdef";

try {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataDir, "users", "hidden-user-a"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "users", "hidden-user-b"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "users", "hidden-user-a", "account.json"), "{}");
  fs.writeFileSync(path.join(dataDir, "users", "hidden-user-a", "grades.json"), "{}");
  fs.writeFileSync(path.join(dataDir, "users", "hidden-user-b", "timetable.json"), "{}");
  fs.writeFileSync(path.join(dataDir, "campus.json"), "{}");

  const result = diagnoseDataDirectory(dataDir);
  assert.strictEqual(result.usersCount, 2);
  assert.strictEqual(result.users.some(user => Object.prototype.hasOwnProperty.call(user, "openid")), false);
  assert.strictEqual(result.users.some(user => Object.prototype.hasOwnProperty.call(user, "userId")), false);
  assert.strictEqual(result.users.every(user => /^[a-f0-9]{10}$/.test(user.userIdHash)), true);
  assert.strictEqual(JSON.stringify(result).includes("hidden-user-a"), false);
  assert.strictEqual(JSON.stringify(result).includes("hidden-user-b"), false);
  assert.deepStrictEqual(result.rootFiles, { campus: true, cookies: false, grades: false });
  assert(result.users.some(user => user.hasAccount && user.hasGrades));
  assert(result.users.some(user => user.hasTimetable));
  console.log("anonymousDataDirectoryDiagnosticTest=passed");

  delete process.env.ADMIN_DIAGNOSTIC_SECRET;
  assert.deepStrictEqual(isDiagnosticAdminAuthorized(adminSecret), { enabled: false, authorized: false });
  process.env.ADMIN_DIAGNOSTIC_SECRET = "set_a_unique_random_value_of_at_least_32_characters";
  assert.deepStrictEqual(isDiagnosticAdminAuthorized(process.env.ADMIN_DIAGNOSTIC_SECRET), { enabled: false, authorized: false });
  process.env.ADMIN_DIAGNOSTIC_SECRET = adminSecret;
  assert.deepStrictEqual(isDiagnosticAdminAuthorized("wrong-admin-diagnostic-secret-value"), { enabled: true, authorized: false });
  assert.deepStrictEqual(isDiagnosticAdminAuthorized(adminSecret), { enabled: true, authorized: true });
  console.log("adminDiagnosticAuthorizationTest=passed");
} finally {
  delete process.env.ADMIN_DIAGNOSTIC_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
}
