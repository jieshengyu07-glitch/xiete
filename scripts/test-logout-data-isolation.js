const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function manualLogoutGuardsTest() {
  const app = read("weapp/app.js");
  const api = read("weapp/utils/api.js");
  const profile = read("weapp/pages/profile/index.js");
  const grades = read("weapp/pages/grades/grades.js");
  const timetable = read("weapp/pages/timetable/timetable.js");

  assert.match(profile, /setStorageSync\(MANUAL_LOGOUT_KEY, true\)/);
  assert.match(api, /getStorageSync\(MANUAL_LOGOUT_KEY\)/);
  assert.match(api, /MANUAL_LOGOUT/);
  assert.match(app, /removeStorageSync\("manualLogout"\)/);
  assert.match(grades, /resetLoggedOutState/);
  assert.match(grades, /grades: \[\]/);
  assert.match(grades, /if \(!wx\.getStorageSync\("token"\)\)/);
  assert.match(grades, /navigateTo\(\{ url: "\/pages\/login\/index" \}\)/);
  assert.match(timetable, /resetLoggedOutState/);
  assert.match(timetable, /sections: defaultSections\(\)/);
  console.log("manualLogoutClearsPageDataTest=passed");
}

function deletionLockTest() {
  const deletion = require("../src/services/userDataDeletion");
  const userId = "logout-isolation-user";
  assert.strictEqual(deletion.isUserDataDeletionPending(userId), false);
  assert.strictEqual(deletion.beginUserDataDeletion(userId), true);
  assert.strictEqual(deletion.beginUserDataDeletion(userId), false);
  assert.strictEqual(deletion.isUserDataDeletionPending(userId), true);
  assert.throws(() => deletion.assertUserDataWritable(userId), err => err && err.code === "DATA_DELETION_IN_PROGRESS");
  deletion.finishUserDataDeletion(userId);
  assert.strictEqual(deletion.isUserDataDeletionPending(userId), false);
  console.log("cloudDeletionRequestLockTest=passed");
}

manualLogoutGuardsTest();
deletionLockTest();
