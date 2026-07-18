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
  const legacyHome = read("weapp/pages/index/index.wxml");
  const privacy = read("weapp/pages/privacy/index.wxml");
  const server = read("src/server.js");

  assert(appJson.pages.includes("pages/privacy/index"));
  const ignoredFolders = (projectConfig.packOptions && projectConfig.packOptions.ignore || [])
    .filter(item => item.type === "folder")
    .map(item => item.value);
  ["pages/course", "pages/food", "pages/rank", "pages/rating", "pages/tools"].forEach(folder => {
    assert(ignoredFolders.includes(folder));
  });
  assert.match(api, /PRIVACY_CONSENT_REQUIRED/);
  assert.match(login, /用户隐私保护指引/);
  assert.match(login, /disabled="\{\{loggingIn \|\| !privacyAccepted\}\}"/);
  assert.match(settings, /用户隐私保护指引/);
  assert.match(settings, /disabled="\{\{binding \|\| !privacyAccepted\}\}"/);
  assert.match(profile, /删除云端个人数据/);
  assert.match(profile, /本小程序为校园工具，不代表学校官方/);
  assert.doesNotMatch(legacyHome, /Cookie|npm start|上传Cookie|调试配置/);
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

try {
  staticReviewChecks();
  cloudDataDeletionTest();
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
