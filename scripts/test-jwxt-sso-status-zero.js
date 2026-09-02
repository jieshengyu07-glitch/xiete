const assert = require("assert");
const {
  sanitizeSsoErrorMessage,
  logSsoRequestFailure
} = require("../src/login/httpJwxtLogin");

const originalLog = console.log;
const lines = [];
console.log = value => lines.push(String(value));
try {
  const error = Object.assign(new Error("request failed password=secret&code=oauth-secret"), {
    code: "ECONNRESET",
    cause: Object.assign(new Error("socket closed"), { code: "EPIPE" })
  });
  logSsoRequestFailure("POST_LOGIN", error);
} finally {
  console.log = originalLog;
}

assert.strictEqual(lines.length, 1);
assert.match(lines[0], /stage=POST_LOGIN/);
assert.match(lines[0], /name=Error/);
assert.match(lines[0], /code=ECONNRESET/);
assert.match(lines[0], /hasResponse=false/);
assert.match(lines[0], /responseStatus=none/);
assert.match(lines[0], /causeCode=EPIPE/);
assert.ok(!lines[0].includes("secret"));
assert.ok(!lines[0].includes("oauth-secret"));
assert.ok(!sanitizeSsoErrorMessage("https://sso.example/login?code=secret").includes("secret"));

console.log("ssoStatusZeroDiagnosticMetadataTest=passed");
console.log("ssoStatusZeroSecretRedactionTest=passed");
