const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const forbiddenNames = ["COOKIES_JSON", "JWXT_STUDENT_ID", "JWXT_PASSWORD"];

function productionEnv(overrides) {
  const env = Object.assign({}, process.env, {
    NODE_ENV: "production",
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "campus-production-env-")),
    JWT_SECRET: "test-jwt-secret-0123456789-ABCDEFGHIJK",
    CREDENTIAL_SECRET: "test-credential-secret-0123456789-ABCDE",
    WECHAT_APPID: "test-appid",
    WECHAT_SECRET: "test-wechat-secret",
    DISABLE_SCHEDULER: "1",
    LEGACY_SINGLE_USER_MODE: "1"
  }, overrides);
  forbiddenNames.forEach(name => {
    if (!Object.prototype.hasOwnProperty.call(overrides, name)) delete env[name];
  });
  return env;
}

for (const name of forbiddenNames) {
  const env = productionEnv({ [name]: "configured-for-test" });
  const dataDir = env.DATA_DIR;
  try {
    const result = spawnSync(process.execPath, ["src/index.js"], {
      cwd: projectRoot,
      env,
      encoding: "utf8",
      timeout: 10000
    });
    const output = String(result.stdout || "") + String(result.stderr || "");
    assert.notStrictEqual(result.status, 0, name + " must reject production startup");
    assert.match(output, /PRODUCTION_LEGACY_CREDENTIALS_FORBIDDEN/);
    assert.match(output, new RegExp(name));
    assert.strictEqual(output.includes("configured-for-test"), false);
    assert.strictEqual(fs.existsSync(path.join(dataDir, "cookies.json")), false);
    console.log("productionRejects" + name + "Test=passed");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
