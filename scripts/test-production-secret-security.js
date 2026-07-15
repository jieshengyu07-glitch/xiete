const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function run(code, overrides) {
  const env = Object.assign({}, process.env, {
    NODE_ENV: "production",
    JWT_SECRET: "production-jwt-secret-0123456789-abcdef",
    CREDENTIAL_SECRET: "production-credential-secret-0123456789-abcdef"
  }, overrides || {});
  return spawnSync(process.execPath, ["-e", code], {
    cwd: projectRoot,
    env,
    encoding: "utf8"
  });
}

let result = run("require('./src/utils/jwt').assertJwtConfig()", { JWT_SECRET: "short" });
assert.notStrictEqual(result.status, 0);
assert.match(String(result.stderr), /at least 32/);

result = run("require('./src/utils/jwt').assertJwtConfig()", { JWT_SECRET: "change_me_to_a_long_random_jwt_secret" });
assert.notStrictEqual(result.status, 0);
assert.match(String(result.stderr), /example value/);

result = run("require('./src/services/credentialStore')", { CREDENTIAL_SECRET: "short" });
assert.notStrictEqual(result.status, 0);
assert.match(String(result.stderr), /at least 32/);

result = run("require('./src/services/credentialStore')", {
  CREDENTIAL_SECRET: "production-jwt-secret-0123456789-abcdef",
  JWT_SECRET: "production-jwt-secret-0123456789-abcdef"
});
assert.notStrictEqual(result.status, 0);
assert.match(String(result.stderr), /independent from JWT_SECRET/);

result = run("require('./src/utils/jwt').assertJwtConfig(); require('./src/services/credentialStore')");
assert.strictEqual(result.status, 0, String(result.stderr));
console.log("productionJwtAndCredentialSecretPolicyTest=passed");
