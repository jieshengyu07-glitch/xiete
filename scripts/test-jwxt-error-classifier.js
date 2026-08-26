const assert = require("assert");
const {
  ERROR_MESSAGES,
  normalizeJwxtLoginError
} = require("../src/services/jwxtLoginError");
const {
  isExplicitCaptchaPage,
  isInvalidCredentialPage
} = require("../src/login/httpJwxtLogin");

const cases = [
  {
    name: "invalid credentials text",
    rawText: "用户名或密码错误，请重新输入",
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "password error wins over explicit captcha prompt",
    rawText: '<div class="auth-error">密码错误</div><label>请输入验证码</label>',
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "explicit captcha page",
    rawText: '<form><input name="captcha_code" required /><span>请输入验证码</span></form>',
    expected: "JWXT_CAPTCHA_REQUIRED"
  },
  {
    name: "generic login failure",
    rawText: '<div class="auth-error">登录失败</div>',
    expected: "JWXT_LOGIN_FAILED"
  },
  {
    name: "server unavailable",
    rawText: '<h1>系统暂时不可用</h1>',
    context: { status: 503 },
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "captcha invalid",
    rawText: "验证码错误",
    expected: "JWXT_CAPTCHA_INVALID"
  },
  {
    name: "sso jsessionid failure",
    rawText: "JSESSIONID was not found after SSO redirects",
    expected: "JWXT_SSO_FAILED"
  },
  {
    name: "timeout",
    rawText: "ETIMEDOUT",
    expected: "JWXT_TIMEOUT"
  },
  {
    name: "captcha field alone is not captcha required",
    rawText: '普通登录页 <input name="captcha" /> 验证码图片',
    expected: "JWXT_LOGIN_FAILED"
  },
  {
    name: "normal portal response stayed on login page",
    rawText: '统一认证登录页 <form id="login-form"></form>',
    context: { portalLoginPageReturned: true, status: 200 },
    expected: "JWXT_LOGIN_FAILED"
  },
  {
    name: "portal login page with 5xx stays unavailable",
    rawText: '统一认证登录页 <form id="login-form"></form>',
    context: { portalLoginPageReturned: true, status: 503 },
    expected: "JWXT_UNAVAILABLE"
  }
];

for (const item of cases) {
  const actual = normalizeJwxtLoginError(item.rawText, item.context).error;
  assert.strictEqual(actual, item.expected, item.name);
  console.log(item.name + " => " + actual);
}

assert.strictEqual(
  ERROR_MESSAGES.JWXT_INVALID_CREDENTIALS,
  "学号或密码错误，请重新输入",
  "invalid credential message"
);

const mixedPasswordCaptchaHtml = '<div class="auth-error">密码错误</div><label>请输入验证码</label>';
assert.strictEqual(isInvalidCredentialPage(mixedPasswordCaptchaHtml), true, "portal invalid credential detector");
assert.strictEqual(isExplicitCaptchaPage(mixedPasswordCaptchaHtml), false, "password evidence suppresses portal captcha classification");
assert.strictEqual(isExplicitCaptchaPage('<span>请输入验证码</span>'), true, "explicit portal captcha detector");
assert.strictEqual(isExplicitCaptchaPage('<input name="captcha" /><img alt="验证码图片" />'), false, "captcha markup alone");
