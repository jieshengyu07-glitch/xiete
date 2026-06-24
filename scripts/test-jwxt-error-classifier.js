const assert = require("assert");
const { normalizeJwxtLoginError } = require("../src/services/jwxtLoginError");

const cases = [
  {
    name: "invalid credentials text",
    rawText: "用户名或密码错误，请重新输入",
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "password error wins over captcha markup",
    rawText: "登录失败，密码错误，页面包含验证码",
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "explicit captcha required",
    rawText: "请输入验证码",
    expected: "JWXT_CAPTCHA_REQUIRED"
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
    expected: "JWXT_INVALID_CREDENTIALS"
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
