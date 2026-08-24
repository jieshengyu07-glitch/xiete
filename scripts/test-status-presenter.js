const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  campusPresentation,
  wechatPresentation,
  timetablePresentation,
  gradesPresentation,
  userErrorMessage,
  formatSyncTime
} = require("../weapp/utils/statusPresenter");

assert.strictEqual(wechatPresentation({}).state, "SIGNED_OUT");
assert.strictEqual(wechatPresentation({ token: "token" }).state, "SIGNED_IN");

assert.strictEqual(campusPresentation({ bound: false }).state, "UNBOUND");
assert.strictEqual(campusPresentation({ bound: true, campusLoginStatus: "valid" }).state, "BOUND");
assert.strictEqual(campusPresentation({ bound: true, lastJwxtError: "ACCOUNT_RELOGIN_REQUIRED" }).state, "RELOGIN_REQUIRED");
assert.strictEqual(campusPresentation({ bound: true, error: "JWXT_CAPTCHA_REQUIRED" }).state, "CAPTCHA_REQUIRED");
assert.strictEqual(campusPresentation({ bound: true, error: "JWXT_UNAVAILABLE" }).state, "SCHOOL_UNAVAILABLE");
assert.strictEqual(campusPresentation({ bound: true, error: "SESSION_DECRYPT_FAILED" }).state, "RELOGIN_REQUIRED");

assert.strictEqual(gradesPresentation({ hasGrades: true, syncStatus: "failed" }).state, "SYNC_FAILED_WITH_CACHE");
assert.strictEqual(gradesPresentation({ hasGrades: false, syncStatus: "failed" }).state, "SYNC_FAILED_NO_CACHE");
assert.strictEqual(timetablePresentation({ hasTimetable: true, syncStatus: "failed" }).state, "SYNC_FAILED_WITH_CACHE");
assert.strictEqual(timetablePresentation({ hasTimetable: false, syncStatus: "failed" }).state, "SYNC_FAILED_NO_CACHE");

const preTerm = timetablePresentation({
  hasTimetable: false,
  termStatus: "PRE_TERM",
  syncStatus: "failed"
});
assert.strictEqual(preTerm.state, "PRE_TERM");
assert.strictEqual(preTerm.title, "新学期尚未开始");
assert.ok(!preTerm.title.includes("暂无"));

assert.strictEqual(userErrorMessage({ error: "RATE_LIMITED" }), "操作太频繁，请稍后再试");
assert.strictEqual(userErrorMessage({ error: "SESSION_DECRYPT_FAILED" }), "校园账号需要重新验证");

const combined = {
  wechat: { state: "SIGNED_IN" },
  campus: campusPresentation({ bound: true, campusLoginStatus: "valid" }),
  timetable: timetablePresentation({ termStatus: "PRE_TERM", hasTimetable: false }),
  grades: gradesPresentation({ hasGrades: true, grades: { state: "CACHED" } })
};
assert.strictEqual(combined.wechat.state, "SIGNED_IN");
assert.strictEqual(combined.campus.state, "BOUND");
assert.strictEqual(combined.timetable.state, "PRE_TERM");
assert.strictEqual(combined.grades.state, "CACHED");

assert.strictEqual(formatSyncTime("2026-08-13T12:34:00+08:00", "2026-08-13T12:34:30+08:00"), "刚刚更新");

const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
assert.match(serverSource, /productStatus:\s*\{/);
assert.match(serverSource, /wechat:\s*\{ state: "SIGNED_IN" \}/);
assert.match(serverSource, /account:\s*\{ state:/);
assert.match(serverSource, /timetable:\s*\{/);
assert.match(serverSource, /grades:\s*\{/);

console.log("Status mapper, cached/no-cache failure, PRE_TERM, rate limit, session failure and combined profile state: PASS");
