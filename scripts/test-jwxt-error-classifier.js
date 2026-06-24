const assert = require("assert");
const { normalizeJwxtLoginError } = require("../src/services/jwxtLoginError");

const cases = [
  ["用户名或密码错误，请重新输入", "JWXT_INVALID_CREDENTIALS"],
  ["登录失败，密码错误，页面包含验证码", "JWXT_INVALID_CREDENTIALS"],
  ["请输入验证码", "JWXT_CAPTCHA_REQUIRED"],
  ["验证码错误", "JWXT_CAPTCHA_INVALID"],
  ["JSESSIONID was not found after SSO redirects", "JWXT_SSO_FAILED"],
  ["ETIMEDOUT", "JWXT_TIMEOUT"],
  ["登录页包含验证码字段，但登录失败，用户名或密码错误", "JWXT_INVALID_CREDENTIALS"],
  ["普通登录页 <input name=\"captcha\" /> 验证码图片", "JWXT_LOGIN_FAILED"]
];

for (const [rawText, expected] of cases) {
  const actual = normalizeJwxtLoginError(rawText).error;
  assert.strictEqual(actual, expected, rawText);
  console.log(rawText + " => " + actual);
}

