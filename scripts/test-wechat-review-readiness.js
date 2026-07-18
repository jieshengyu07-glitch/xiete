const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-review-readiness-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = dataDir;
process.env.CREDENTIAL_SECRET = process.env.CREDENTIAL_SECRET || "review-test-credential-secret-0123456789-abcdef";

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function staticReviewChecks() {
  const appJson = JSON.parse(read("weapp/app.json"));
  const projectConfig = JSON.parse(read("weapp/project.config.json"));
  const api = read("weapp/utils/api.js");
  const login = read("weapp/pages/login/index.wxml");
  const settings = read("weapp/pages/settings/settings.wxml");
  const profile = read("weapp/pages/profile/index.wxml");
  const legacyEntry = read("weapp/pages/index/index.js");
  const legacyEntryView = read("weapp/pages/index/index.wxml");
  const privacy = read("weapp/pages/privacy/index.wxml");
  const server = read("src/server.js");

  assert(appJson.pages.includes("pages/privacy/index"));
  assert.strictEqual(appJson.pages[0], "pages/index/index");
  assert.strictEqual(appJson.pages.includes("pages/index/index"), true);
  assert.doesNotMatch(legacyEntry, /onLoad\(\)[\s\S]*loginWithWechat/);
  assert.match(legacyEntryView, /仅限太原科技大学在校学生/);
  assert.match(legacyEntryView, /学校统一身份认证系统核验账号有效性/);
  assert.match(legacyEntryView, /不获取用户手机号/);
  assert.match(legacyEntryView, /我符合服务对象条件，继续登录/);
  assert.doesNotMatch(legacyEntryView, /成绩监测中心|服务状态|最近成绩变化/);
  const ignoredFolders = (projectConfig.packOptions && projectConfig.packOptions.ignore || [])
    .filter(item => item.type === "folder")
    .map(item => item.value);
  ["pages/course", "pages/food", "pages/rank", "pages/rating", "pages/tools"].forEach(folder => {
    assert(ignoredFolders.includes(folder));
  });
  assert.match(api, /PRIVACY_CONSENT_REQUIRED/);
  assert.match(api, /if \(!force\)/);
  assert.match(api, /AUTH_REQUIRED/);
  assert.match(login, /用户隐私保护指引/);
  assert.match(login, /仅限太原科技大学在校学生/);
  assert.match(login, /不获取手机号/);
  assert.match(login, /微信身份登录（不获取手机号）/);
  assert.match(login, /disabled="\{\{loggingIn \|\| !privacyAccepted\}\}"/);
  assert.match(settings, /用户隐私保护指引/);
  assert.match(settings, /disabled="\{\{binding \|\| !privacyAccepted\}\}"/);
  assert.match(profile, /删除云端个人数据/);
  assert.match(profile, /本小程序为校园工具，不代表学校官方/);
  assert.match(privacy, /微信登录临时凭证/);
  assert.match(privacy, /加密保存的校园账号密码/);
  assert.match(privacy, /不记录账号密码或登录凭据原文/);
  assert.match(privacy, /永久删除云端保存/);
  assert.match(server, /app\.delete\("\/account\/data", auth/);
  assert.match(server, /app\.post\("\/account\/delete-data", auth/);
  assert.match(server, /scheduleFinalUserDataDeletion/);
  assert.doesNotMatch(server, /error: "DATA_SYNC_IN_PROGRESS"/);
  console.log("wechatReviewPrivacySurfaceTest=passed");
}

function cloudDataDeletionTest() {
  const persistence = require("../src/services/userPersistence");
  const { getUserPaths } = require("../src/services/userPaths");
  const userId = "review-delete-user";
  const paths = persistence.initUserData(userId);
  persistence.saveGradesCache(userId, [{ courseName: "Private Course", score: "90" }]);
  assert.strictEqual(fs.existsSync(paths.userDir), true);
  assert.strictEqual(fs.existsSync(getUserPaths(userId).gradesPath), true);
  assert.strictEqual(persistence.deleteUserData(userId), true);
  assert.strictEqual(fs.existsSync(paths.userDir), false);
  console.log("userInitiatedCloudDataDeletionTest=passed");
}

function publicLandingDoesNotAutoLoginTest() {
  const indexPath = path.join(root, "weapp/pages/index/index.js");
  let pageDefinition;
  let navigatedTo = "";
  let loginOrRequestCalls = 0;
  const originalPage = global.Page;
  const originalWx = global.wx;
  global.Page = definition => { pageDefinition = definition; };
  global.wx = {
    getStorageSync: () => "",
    navigateTo: options => { navigatedTo = options.url; },
    switchTab: () => {},
    login: () => { loginOrRequestCalls += 1; },
    request: () => { loginOrRequestCalls += 1; }
  };
  try {
    delete require.cache[require.resolve(indexPath)];
    require(indexPath);
    const page = Object.assign({}, pageDefinition, {
      data: Object.assign({}, pageDefinition.data),
      setData(patchValue) { Object.assign(this.data, patchValue); }
    });
    page.onShow();
    assert.strictEqual(loginOrRequestCalls, 0);
    assert.strictEqual(navigatedTo, "");
    page.continueToService();
    assert.strictEqual(loginOrRequestCalls, 0);
    assert.strictEqual(navigatedTo, "/pages/login/index");
    console.log("publicLandingDoesNotAutoLoginTest=passed");
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
  }
}

try {
  staticReviewChecks();
  publicLandingDoesNotAutoLoginTest();
  cloudDataDeletionTest();
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
