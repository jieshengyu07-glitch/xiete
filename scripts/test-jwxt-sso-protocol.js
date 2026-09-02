const assert = require("assert");
const {
  parseCurrentSsoLoginForm,
  buildCurrentSsoLoginPayload,
  encryptPassword
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
const body = new URLSearchParams(buildCurrentSsoLoginPayload({
  username: "synthetic-student",
  password: encrypted,
  execution: protocol.execution,
  crypto: protocol.crypto,
  captchaPayload: protocol.captchaPayload,
  service: protocol.service
}));

for (const key of ["username", "type", "_eventId", "geolocation", "execution", "captcha_code", "crypto", "password", "captcha_payload"]) {
  assert.ok(body.has(key), "missing protocol field: " + key);
}
assert.strictEqual(body.get("execution"), "exec-A");
assert.strictEqual(body.get("crypto"), protocol.crypto);
assert.strictEqual(body.get("croypto"), protocol.crypto);
assert.strictEqual(body.get("captcha_payload"), "payload-A");
assert.strictEqual(body.get("service"), protocol.service);

const fixtureB = fixture.replace("exec-A", "exec-B").replace("payload-A", "payload-B");
assert.notStrictEqual(parseCurrentSsoLoginForm(fixtureB).execution, protocol.execution);
assert.notStrictEqual(parseCurrentSsoLoginForm(fixtureB).captchaPayload, protocol.captchaPayload);

console.log("jwxtSsoProtocolParsingTest=passed");
console.log("jwxtSsoPayloadFieldsTest=passed");
console.log("jwxtSsoDynamicTokenTest=passed");
