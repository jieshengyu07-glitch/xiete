const assert = require("assert");
const {
  parseCurrentSsoLoginForm,
  buildCurrentSsoLoginPayload,
  encryptPassword,
  encryptCaptchaPayload,
  ssoValueShape,
  describeSsoPostShape
} = require("../src/login/httpJwxtLogin");

const fixture = [
  '<form action="/login?service=%2Foauth2.0%2FcallbackAuthorize" method="post">',
  '<input type="hidden" name="execution" value="exec-A">',
  '<input type="hidden" name="service" value="/oauth2.0/callbackAuthorize">',
  '<p id="login-page-flowkey">fallback-exec</p>',
  '<p id="login-croypto">c2FtcGxlLWtleQ==</p>',
  '<input type="hidden" name="captcha_payload" value="payload-A">',
  '</form>'
].join("");

const protocol = parseCurrentSsoLoginForm(fixture);
assert.strictEqual(protocol.execution, "exec-A");
assert.strictEqual(protocol.crypto, "c2FtcGxlLWtleQ==");
assert.strictEqual(protocol.captchaPayload, "payload-A");
assert.strictEqual(protocol.service, "/oauth2.0/callbackAuthorize");

const encrypted = encryptPassword(protocol.crypto, "synthetic-password");
assert.ok(encrypted && encrypted.length > 0, "password transform should complete");
const encryptedCaptchaPayload = encryptCaptchaPayload(protocol.crypto, protocol.captchaPayload);
const body = new URLSearchParams(buildCurrentSsoLoginPayload({
  username: "synthetic-student",
  password: encrypted,
  execution: protocol.execution,
  crypto: protocol.crypto,
  captchaPayload: encryptedCaptchaPayload,
  service: protocol.service
}));

for (const key of ["username", "type", "_eventId", "geolocation", "execution", "captcha_code", "password", "captcha_payload", "croypto"]) {
  assert.ok(body.has(key), "missing protocol field: " + key);
}
assert.strictEqual(body.get("execution"), "exec-A");
assert.strictEqual(body.get("croypto"), protocol.crypto);
assert.ok(body.get("captcha_payload"), "captcha_payload must be encrypted, even without a challenge");
assert.strictEqual(body.get("service"), protocol.service);
assert.strictEqual(ssoValueShape(body.get("execution")), "plain");
assert.strictEqual(ssoValueShape(body.get("captcha_payload")), "base64-like");
const shape = describeSsoPostShape(body.toString(), {
  "Content-Type": "application/x-www-form-urlencoded",
  Origin: "https://sso1.tyust.edu.cn",
  Referer: "https://sso1.tyust.edu.cn/login"
}, [], "https://sso1.tyust.edu.cn/login");
assert.ok(shape.fieldNames.includes("captcha_payload"));
assert.ok(shape.bodyLength > 0);

const fixtureB = fixture.replace("exec-A", "exec-B").replace("payload-A", "payload-B");
assert.notStrictEqual(parseCurrentSsoLoginForm(fixtureB).execution, protocol.execution);
assert.notStrictEqual(parseCurrentSsoLoginForm(fixtureB).captchaPayload, protocol.captchaPayload);

console.log("jwxtSsoProtocolParsingTest=passed");
console.log("jwxtSsoPayloadFieldsTest=passed");
console.log("jwxtSsoDynamicTokenTest=passed");
