const assert = require("assert");
const path = require("path");

const storage = new Map();
const switched = [];
let pageDefinition = null;
const app = {
  globalData: {},
  loginWithWechat() {
    return Promise.resolve({ token: "test" });
  }
};

global.getApp = () => app;
global.Page = definition => { pageDefinition = definition; };
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  showToast() {},
  switchTab(options) { switched.push(options.url); },
  navigateTo() {},
  openPrivacyContract() {}
};

const modulePath = path.resolve(__dirname, "../weapp/pages/login/index.js");
delete require.cache[modulePath];
require(modulePath);

function createPage() {
  const page = Object.assign({}, pageDefinition);
  page.data = Object.assign({}, pageDefinition.data);
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

async function loginFrom(intent) {
  const page = createPage();
  page.onLoad({ redirect: intent });
  page.onShow();
  page.login();
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  const firstVisit = createPage();
  firstVisit.onLoad({});
  firstVisit.onShow();
  assert.strictEqual(firstVisit.data.privacyAccepted, false, "first visit must remain unchecked");

  storage.set("privacyAccepted", true);
  const revisit = createPage();
  revisit.onLoad({});
  revisit.onShow();
  assert.strictEqual(revisit.data.privacyAccepted, true, "prior explicit consent must be preserved");

  storage.delete("privacyAccepted");
  revisit.onShow();
  assert.strictEqual(revisit.data.privacyAccepted, false, "withdrawal must return to unchecked");

  storage.set("privacyAccepted", true);
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = callback => { callback(); return 1; };
  try {
    await loginFrom("grades");
    await loginFrom("timetable");
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.deepStrictEqual(switched.slice(-2), [
    "/pages/grades/grades",
    "/pages/timetable/timetable"
  ]);

  console.log("Consent first visit/revisit/withdrawal and login route intent: PASS");
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
