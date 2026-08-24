const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function gradeRefreshKeepsVisibleCacheTest() {
  const source = read("weapp/pages/grades/grades.js");
  assert.match(source, /keepVisibleGrades = syncing && !grades\.length && this\.data\.grades\.length/);
  assert.match(source, /selectedKey = this\.data\.currentGroup && this\.data\.currentGroup\.key/);
  assert.match(source, /if \(this\.data\.refreshing \|\| this\.data\.syncing\)/);
  assert.match(source, /finally \{/);
  console.log("gradeRefreshKeepsVisibleCacheTest=passed");
}

function independentLoadingAndProgressTest() {
  const grades = read("weapp/pages/grades/grades.js");
  const timetable = read("weapp/pages/timetable/timetable.js");
  const profile = read("weapp/pages/profile/index.js");
  assert.match(grades, /isInitialLoading/);
  assert.match(timetable, /isInitialLoading/);
  assert.match(grades, /学校系统响应较慢，可以先浏览其他页面/);
  assert.match(timetable, /学校系统响应较慢，可以先浏览其他页面/);
  assert.match(profile, /const manual = Boolean\(options && options\.manual\)/);
  console.log("independentLoadingAndProgressTest=passed");
}

function consentAndSuccessActionsTest() {
  const settingsJs = read("weapp/pages/settings/settings.js");
  const settingsWxml = read("weapp/pages/settings/settings.wxml");
  assert.match(settingsJs, /onShow\(\) \{\s*this\.setData\(\{ privacyAccepted: Boolean\(wx\.getStorageSync\("privacyAccepted"\)\) \}\)/);
  assert.match(settingsWxml, /查看我的成绩/);
  assert.match(settingsWxml, /查看今日课表/);
  assert.match(settingsWxml, /密码由服务端加密保存/);
  console.log("consentAndSuccessActionsTest=passed");
}

gradeRefreshKeepsVisibleCacheTest();
independentLoadingAndProgressTest();
consentAndSuccessActionsTest();
