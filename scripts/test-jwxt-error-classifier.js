const assert = require("assert");
const {
  ERROR_MESSAGES,
  normalizeJwxtLoginError
} = require("../src/services/jwxtLoginError");
const {
  isExplicitCaptchaPage,
  isInvalidCredentialPage
} = require("../src/login/httpJwxtLogin");
const { formatJwxtErrorMessage } = require("../weapp/utils/jwxtError");

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
    rawText: Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }),
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "raw timeout code text",
    rawText: "ETIMEDOUT",
    expected: "JWXT_UNAVAILABLE"
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

[
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ESOCKETTIMEDOUT"
].forEach(code => cases.push({
  name: "network code " + code,
  rawText: Object.assign(new Error("upstream request failed"), { code }),
  expected: "JWXT_UNAVAILABLE"
}));

[502, 503, 504, 521, 522, 523, 524].forEach(status => cases.push({
  name: "upstream HTTP " + status,
  rawText: { response: { status, data: "upstream error" } },
  expected: "JWXT_UNAVAILABLE"
}));

cases.push(
  {
    name: "nested DNS cause",
    rawText: Object.assign(new Error("login page fetch failed"), {
      cause: Object.assign(new Error("DNS lookup failed"), { code: "EAI_AGAIN" })
    }),
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "network evidence wins over credential text",
    rawText: Object.assign(new Error("用户名或密码错误"), { code: "ECONNABORTED" }),
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "TLS connection failure",
    rawText: Object.assign(new Error("TLS connection failure"), { code: "EPROTO" }),
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "empty upstream response",
    rawText: { upstreamResponseEmpty: true },
    expected: "JWXT_UNAVAILABLE"
  },
  {
    name: "account or password credential error",
    rawText: "账号或密码错误",
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "student id or password credential error",
    rawText: "学号或密码错误",
    expected: "JWXT_INVALID_CREDENTIALS"
  },
  {
    name: "generic login service exception",
    rawText: "登录服务异常",
    expected: "JWXT_LOGIN_FAILED"
  },
  {
    name: "generic temporarily unable to log in",
    rawText: "系统暂时无法登录",
    expected: "JWXT_LOGIN_FAILED"
  },
  {
    name: "credential field label is not credential error",
    rawText: "请输入用户名或密码",
    expected: "JWXT_LOGIN_FAILED"
  }
);

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
assert.strictEqual(
  ERROR_MESSAGES.JWXT_UNAVAILABLE,
  "学校官网叒崩了，一会再重试吧",
  "backend unavailable message"
);
assert.strictEqual(
  formatJwxtErrorMessage({ error: "JWXT_UNAVAILABLE" }),
  "学校官网叒崩了，一会再重试吧",
  "mini-program unavailable message"
);
assert.strictEqual(
  formatJwxtErrorMessage({ error: "ETIMEDOUT", message: "用户名或密码错误" }),
  "学校官网叒崩了，一会再重试吧",
  "mini-program network priority"
);
assert.strictEqual(
  formatJwxtErrorMessage({ message: "upstream status 503" }),
  "学校官网叒崩了，一会再重试吧",
  "mini-program upstream HTTP message"
);
assert.strictEqual(
  formatJwxtErrorMessage({ error: "JWXT_INVALID_CREDENTIALS" }),
  "学号或密码错误，请重新输入",
  "mini-program invalid credential message"
);

const mixedPasswordCaptchaHtml = '<div class="auth-error">密码错误</div><label>请输入验证码</label>';
assert.strictEqual(isInvalidCredentialPage(mixedPasswordCaptchaHtml), true, "portal invalid credential detector");
assert.strictEqual(isExplicitCaptchaPage(mixedPasswordCaptchaHtml), false, "password evidence suppresses portal captcha classification");
assert.strictEqual(isExplicitCaptchaPage('<span>请输入验证码</span>'), true, "explicit portal captcha detector");
assert.strictEqual(isExplicitCaptchaPage('<input name="captcha" /><img alt="验证码图片" />'), false, "captcha markup alone");
