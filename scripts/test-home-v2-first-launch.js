const assert = require("assert");
const fs = require("fs");
const path = require("path");
const onboarding = require("../weapp/utils/onboarding");

function storageFixture() {
  const values = new Map();
  return {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: key => values.delete(key),
    clearStorageSync: () => values.clear()
  };
}

const storage = storageFixture();
assert.strictEqual(onboarding.shouldShowGuide(storage, {}), true);
assert.strictEqual(onboarding.isCompleted(storage), false);

onboarding.complete(storage);
assert.strictEqual(storage.getStorageSync("campus_assistant_onboarding_completed"), true);
assert.strictEqual(onboarding.shouldShowGuide(storage, {}), false);

// Binding state is deliberately absent: onboarding remains complete and the
// returning user still skips the guide.
assert.strictEqual(storage.getStorageSync("jwxtBound"), undefined);
assert.strictEqual(onboarding.shouldShowGuide(storage, {}), false);

assert.strictEqual(onboarding.shouldShowGuide(storage, { mode: "manual" }), true);
assert.strictEqual(onboarding.isCompleted(storage), true);

storage.clearStorageSync();
assert.strictEqual(onboarding.shouldShowGuide(storage, {}), true);

const root = path.resolve(__dirname, "..");
const appJson = JSON.parse(fs.readFileSync(path.join(root, "weapp/app.json"), "utf8"));
const indexJs = fs.readFileSync(path.join(root, "weapp/pages/index/index.js"), "utf8");
const indexWxml = fs.readFileSync(path.join(root, "weapp/pages/index/index.wxml"), "utf8");
const settingsJs = fs.readFileSync(path.join(root, "weapp/pages/settings/settings.js"), "utf8");
const settingsWxml = fs.readFileSync(path.join(root, "weapp/pages/settings/settings.wxml"), "utf8");
const timetableJs = fs.readFileSync(path.join(root, "weapp/pages/timetable/timetable.js"), "utf8");
const timetableWxml = fs.readFileSync(path.join(root, "weapp/pages/timetable/timetable.wxml"), "utf8");

assert.ok(appJson.tabBar.list.some(item => item.pagePath === "pages/timetable/timetable"));
assert.match(indexJs, /if \(!onboarding\.shouldShowGuide\(wx, options\)\)[\s\S]*wx\.switchTab\(\{ url: "\/pages\/timetable\/timetable" \}\)/);
assert.ok(!/redirectTo|reLaunch/.test(indexJs));
assert.match(indexWxml, /wx:if="\{\{guideReady\}\}"/);
assert.match(indexJs, /if \(!this\.data\.manualGuide\) onboarding\.complete\(wx\)/);
assert.match(settingsWxml, /使用说明[\s\S]*查看服务对象与使用说明/);
assert.match(settingsJs, /pages\/index\/index\?mode=manual/);
assert.match(timetableJs, /announcementService\.loadAnnouncement\(\{ allowAutoPopup: true \}\)/);
assert.match(timetableWxml, /showAnnouncementBanner/);
assert.match(timetableWxml, /<announcement-modal/);

console.log("freshInstallShowsGuideTest=passed");
console.log("guideCompletionPersistsTest=passed");
console.log("returningUserSwitchesDirectlyToTimetableTest=passed");
console.log("unboundReturningUserSkipsGuideTest=passed");
console.log("manualGuideDoesNotChangeCompletionTest=passed");
console.log("clearedStorageRestoresFirstLaunchTest=passed");
console.log("returningTimetableAnnouncementCompatibilityTest=passed");
