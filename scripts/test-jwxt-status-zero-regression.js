const assert = require("assert");
const {
  normalizeJwxtLoginError,
  isJwxtUpstreamFailure
} = require("../src/services/jwxtLoginError");

// A synthetic status=0 result without transport evidence remains unconfirmed.
assert.strictEqual(
  normalizeJwxtLoginError({ status: 0, finalHost: "sso1.tyust.edu.cn", pathname: "/login" }).error,
  "JWXT_LOGIN_FAILED"
);
assert.strictEqual(
  isJwxtUpstreamFailure({ status: 0 }),
  false
);

for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
  const error = Object.assign(new Error("synthetic transport failure"), { code });
  assert.strictEqual(isJwxtUpstreamFailure(error), true, code);
  assert.strictEqual(normalizeJwxtLoginError(error).error, "JWXT_UNAVAILABLE", code);
}

assert.strictEqual(
  normalizeJwxtLoginError({ status: 0, data: '<form><input name="username"><input name="password"></form>' }).error,
  "JWXT_LOGIN_FAILED"
);

console.log("statusZeroWithoutNetworkEvidenceRemainsUnconfirmedTest=passed");
console.log("statusZeroConnectionResetUnavailableTest=passed");
console.log("statusZeroTimeoutUnavailableTest=passed");
console.log("statusZeroOrdinaryLoginFormNotCredentialsTest=passed");
