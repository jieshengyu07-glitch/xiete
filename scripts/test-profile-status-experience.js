const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/profile/index.js"), "utf8");
assert.strictEqual(source.includes('const api = require("../../utils/api")'), true);
assert.strictEqual(source.includes("wx.request({"), false);
assert.strictEqual(source.includes('require("../../utils/statusPresenter")'), true);
assert.strictEqual(source.includes("campusPresentation"), true);
assert.strictEqual(source.includes("timetablePresentation"), true);
assert.strictEqual(source.includes("gradesPresentation"), true);
assert.strictEqual(source.includes("scheduleStatusPolling"), true);
console.log("profileSharedAuthAndRecoveryStatusTest=passed");
