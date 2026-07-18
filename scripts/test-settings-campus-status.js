const assert = require("assert");
const path = require("path");

const settingsPath = path.resolve(__dirname, "../weapp/pages/settings/settings.js");
const apiPath = path.resolve(__dirname, "../weapp/utils/api.js");
let boundHint = true;
let statusResponse = {};
let captchaResponse = {};
let postHandler = async () => ({});
let pageDefinition;
let latestModal;
let latestToast;

global.getApp = () => ({ globalData: { apiBase: "https://example.invalid" } });
global.wx = {
  getStorageSync: key => key === "jwxtBound" ? boundHint : "",
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: options => { latestToast = options; },
  showModal: options => { latestModal = options; }
};
global.Page = definition => { pageDefinition = definition; };

require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: {
    request: async path => path.startsWith("/jwxt/captcha-session?") ? captchaResponse : statusResponse,
    post: (path, data, options) => postHandler(path, data, options)
  }
};

require(settingsPath);

function createPage(data) {
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data, data || {})
  });
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  statusResponse = {
    bound: true,
    campusLoginStatus: "recovering",
    jwxtStatus: "SSO_FAILED",
    cookieStatus: "JWXT_SSO_FAILED"
  };
  const recoveringPage = createPage();
  recoveringPage.refreshStatus();
  await flush();
  assert.strictEqual(recoveringPage.data.status, "BOUND");
  assert.strictEqual(recoveringPage.data.hasBoundJwxt, true);
  assert.strictEqual(recoveringPage.data.showRebindActions, false);
  assert.strictEqual(recoveringPage.data.statusTitle, "账号已绑定");
  console.log("recoveringStatusOverridesLegacyJwxtFailureTest=passed");

  statusResponse = {
    bound: true,
    campusLoginStatus: "valid",
    jwxtStatus: "COOKIE_EXPIRED",
    cookieStatus: "COOKIE_EXPIRED"
  };
  const validPage = createPage();
  validPage.refreshStatus();
  await flush();
  assert.strictEqual(validPage.data.status, "SYNC_OK");
  assert.strictEqual(validPage.data.showRebindActions, false);
  console.log("validCampusStatusOverridesStaleCookieErrorTest=passed");

  statusResponse = {
    bound: true,
    campusLoginStatus: "relogin_required",
    jwxtStatus: "LOGIN_FAILED"
  };
  const reloginPage = createPage();
  reloginPage.refreshStatus();
  await flush();
  assert.strictEqual(reloginPage.data.status, "SYNC_FAILED");
  assert.strictEqual(reloginPage.data.showRebindActions, true);
  console.log("explicitReloginRequiredShowsRebindTest=passed");

  latestModal = null;
  const transientPage = createPage({ hasBoundJwxt: true });
  transientPage.handleBindFailure({ error: "JWXT_UNAVAILABLE", message: "temporary" });
  assert.strictEqual(transientPage.data.status, "BOUND");
  assert.strictEqual(transientPage.data.showRebindActions, false);
  assert.strictEqual(transientPage.data.statusTitle, "账号已绑定");
  assert.strictEqual(latestModal, null);
  console.log("transientRebindFailureKeepsBoundRecoveryStateTest=passed");

  boundHint = false;
  statusResponse = { bound: false, campusLoginStatus: "not_bound" };
  const unboundPage = createPage();
  unboundPage.refreshStatus();
  await flush();
  assert.strictEqual(unboundPage.data.status, "UNBOUND");
  console.log("authoritativeUnboundStatusIgnoresStaleUiStateTest=passed");

  latestModal = null;
  latestToast = null;
  captchaResponse = {
    success: true,
    sessionId: "captcha-session-test",
    captchaImage: "data:image/png;base64,dGVzdA=="
  };
  postHandler = async path => {
    if (path === "/bind-account") {
      throw {
        statusCode: 400,
        error: "PORTAL_VERIFICATION_REQUIRED",
        message: "captcha required"
      };
    }
    return {};
  };
  const captchaPage = createPage({
    studentId: "review-student",
    password: "temporary-password",
    privacyAccepted: true,
    hasBoundJwxt: false
  });
  await captchaPage.bindAccount();
  await flush();
  assert.strictEqual(captchaPage.data.showCaptcha, true);
  assert.strictEqual(captchaPage.data.captchaSessionId, "captcha-session-test");
  assert.strictEqual(captchaPage.data.captchaImage, captchaResponse.captchaImage);
  assert.strictEqual(latestModal, null);
  console.log("captchaRequiredOpensInlineChallengeTest=passed");

  let captchaLoginPayload;
  postHandler = async (path, data) => {
    assert.strictEqual(path, "/jwxt/login-with-captcha");
    captchaLoginPayload = data;
    return { success: true };
  };
  captchaPage.setData({ captchaValue: "A7K9" });
  await captchaPage.submitCaptcha();
  assert.deepStrictEqual(captchaLoginPayload, {
    sessionId: "captcha-session-test",
    studentId: "review-student",
    password: "temporary-password",
    captcha: "A7K9"
  });
  assert.strictEqual(captchaPage.data.showCaptcha, false);
  assert.strictEqual(captchaPage.data.password, "");
  assert.strictEqual(captchaPage.data.hasBoundJwxt, true);
  assert.strictEqual(latestToast.title, "绑定成功");
  console.log("captchaSuccessCompletesBindingAndClearsSecretTest=passed");

  latestModal = null;
  const unavailableReviewPage = createPage({ hasBoundJwxt: false });
  unavailableReviewPage.handleBindFailure({
    error: "REVIEW_DEMO_UNAVAILABLE",
    message: "review demo disabled"
  });
  assert.strictEqual(unavailableReviewPage.data.showCaptcha, false);
  assert.strictEqual(unavailableReviewPage.data.status, "UNBOUND");
  assert.strictEqual(latestModal.title, "审核账号未启用");
  console.log("disabledReviewAccountDoesNotEnterCaptchaFlowTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
