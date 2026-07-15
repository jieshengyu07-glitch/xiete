const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/profile/index.js"), "utf8");
assert.strictEqual(source.includes('const api = require("../../utils/api")'), true);
assert.strictEqual(source.includes("wx.request({"), false);
assert.strictEqual(source.includes('value === "not_bound"'), true);
assert.strictEqual(source.includes('value === "recovering"'), true);
assert.strictEqual(source.includes("scheduleStatusPolling"), true);
console.log("profileSharedAuthAndRecoveryStatusTest=passed");
