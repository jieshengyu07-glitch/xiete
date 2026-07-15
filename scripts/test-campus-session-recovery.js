const assert = require("assert");
process.env.CREDENTIAL_SECRET = process.env.CREDENTIAL_SECRET || "recovery-test-credential-secret-0123456789-abcdef";
const {
  MAX_FAILED_ATTEMPTS,
  recoverCampusSession,
  resetRecoveryStateForTests
} = require("../src/sync/campusSessionRecovery");

async function main() {
  resetRecoveryStateForTests();
  let cookiesSaved = false;
  const cookieRecovery = await recoverCampusSession("cookie-user", "jwxt", async () => {
    cookiesSaved = true;
    return [{ name: "JSESSIONID", value: "restored" }];
  });
  assert.strictEqual(cookieRecovery.success, true);
  assert.strictEqual(cookiesSaved, true);
  console.log("cookieExpiredAutoRecoverySuccessTest=passed");

  resetRecoveryStateForTests();
  const passwordError = await recoverCampusSession("password-user", "jwxt", async () => {
    const err = new Error("password error");
    err.code = "JWXT_INVALID_CREDENTIALS";
    throw err;
  });
  assert.strictEqual(passwordError.error, "ACCOUNT_RELOGIN_REQUIRED");
  assert.strictEqual(passwordError.causeCode, "JWXT_INVALID_CREDENTIALS");
  console.log("cookieExpiredPasswordErrorTest=passed");

  resetRecoveryStateForTests();
  let xgSessionSaved = false;
  const xgRecovery = await recoverCampusSession("xg-user", "xg", async () => {
    xgSessionSaved = true;
    return { scoreUrl: "https://xg.example/score", cookies: "restored" };
  });
  assert.strictEqual(xgRecovery.success, true);
  assert.strictEqual(xgSessionSaved, true);
  console.log("xgSessionExpiredAutoRecoveryTest=passed");

  resetRecoveryStateForTests();
  const failedRecovery = await recoverCampusSession("failed-user", "xg", async () => {
    const err = new Error("session expired");
    err.code = "XG_LOGIN_REQUIRED";
    throw err;
  });
  assert.deepStrictEqual(
    { error: failedRecovery.error, message: failedRecovery.message },
    { error: "ACCOUNT_RELOGIN_REQUIRED", message: "校园账号登录已过期，请重新绑定" }
  );
  console.log("recoveryFailureReloginResponseTest=passed");

  resetRecoveryStateForTests();
  let attempts = 0;
  for (let index = 0; index < MAX_FAILED_ATTEMPTS; index += 1) {
    await recoverCampusSession("limited-user", "jwxt", async () => {
      attempts += 1;
      throw Object.assign(new Error("failed"), { code: "JWXT_LOGIN_FAILED" });
    });
  }
  const limited = await recoverCampusSession("limited-user", "jwxt", async () => {
    attempts += 1;
  });
  assert.strictEqual(attempts, MAX_FAILED_ATTEMPTS);
  assert.strictEqual(limited.causeCode, "ACCOUNT_RECOVERY_RATE_LIMITED");
  assert(limited.retryAfterSeconds > 0);
  console.log("recoveryRateLimitTest=passed");

  resetRecoveryStateForTests();
  const modulePath = require.resolve("../src/sync/campusSessionRecovery");
  const restartUser = "restart-limited-user";
  await recoverCampusSession(restartUser, "jwxt", async () => {
    throw Object.assign(new Error("failed-before-restart"), { code: "JWXT_LOGIN_FAILED" });
  });
  delete require.cache[modulePath];
  const afterRestart = require(modulePath);
  let restartAttempts = 0;
  await afterRestart.recoverCampusSession(restartUser, "jwxt", async () => {
    restartAttempts += 1;
    throw Object.assign(new Error("failed-after-restart"), { code: "JWXT_LOGIN_FAILED" });
  });
  delete require.cache[modulePath];
  const afterSecondRestart = require(modulePath);
  const persistedLimit = await afterSecondRestart.recoverCampusSession(restartUser, "jwxt", async () => {
    restartAttempts += 1;
  });
  assert.strictEqual(restartAttempts, 1);
  assert.strictEqual(persistedLimit.causeCode, "ACCOUNT_RECOVERY_RATE_LIMITED");
  afterSecondRestart.resetRecoveryStateForTests();
  console.log("recoveryRateLimitSurvivesRestartTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
