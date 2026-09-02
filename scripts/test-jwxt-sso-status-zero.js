const assert = require("assert");
const {
  sanitizeSsoErrorMessage,
  logSsoRequestFailure,
  logSsoFlowFailure
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

const flowLines = [];
console.log = value => flowLines.push(String(value));
try {
  logSsoFlowFailure("BUILD_LOGIN_PAYLOAD", "PASSWORD_TRANSFORM_FAILED", new Error("synthetic"), "https://sso1.tyust.edu.cn/login?code=secret");
} finally {
  console.log = originalLog;
}
assert.strictEqual(flowLines.length, 1);
assert.match(flowLines[0], /stage=BUILD_LOGIN_PAYLOAD/);
assert.match(flowLines[0], /reasonCode=PASSWORD_TRANSFORM_FAILED/);
assert.match(flowLines[0], /hostname=sso1\.tyust\.edu\.cn/);
assert.match(flowLines[0], /pathname=\/login/);
assert.ok(!flowLines[0].includes("secret"));

console.log("ssoStatusZeroDiagnosticMetadataTest=passed");
console.log("ssoStatusZeroSecretRedactionTest=passed");
console.log("ssoFlowFailureDiagnosticTest=passed");
