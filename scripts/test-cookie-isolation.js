const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-cookie-isolation-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = dataDir;
process.env.COOKIES_JSON = JSON.stringify([
  { name: "JSESSIONID", value: "legacy-only", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" }
]);

const { getUserPaths } = require("../src/services/userPaths");
const { loadCookies, writeCookies } = require("../src/checker");

const userA = "cookie_isolation_user_A";
const userB = "cookie_isolation_user_B";
const userACookies = [
  { name: "JSESSIONID", value: "user-a-only", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" }
];

try {
  writeCookies(userACookies, userA);

  assert.deepStrictEqual(loadCookies(userA), userACookies);
  assert.strictEqual(fs.existsSync(getUserPaths(userB).cookiesPath), false);
  assert.strictEqual(loadCookies(userB), null);
  assert.notDeepStrictEqual(loadCookies(userB), loadCookies(userA));

  const legacyCookies = loadCookies();
  assert.strictEqual(Array.isArray(legacyCookies), true);
  assert.strictEqual(legacyCookies.length, 1);

  console.log("userACookieReadTest=passed");
  console.log("userBNoFallbackTest=passed");
  console.log("legacyDevelopmentFallbackTest=passed");
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
