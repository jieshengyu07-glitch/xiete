const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

async function captureStartup(nodeEnv, port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-scheduler-policy-"));
  const env = Object.assign({}, process.env, {
    NODE_ENV: nodeEnv,
    DATA_DIR: dataDir,
    JWT_SECRET: "scheduler-test-jwt-secret-0123456789-ABCDE",
    CREDENTIAL_SECRET: "scheduler-test-credential-secret-0123456789",
    WECHAT_APPID: "scheduler-test-appid",
    WECHAT_SECRET: "scheduler-test-secret",
    PORT: String(port)
  });
  delete env.DISABLE_SCHEDULER;
  delete env.COOKIES_JSON;
  delete env.JWXT_STUDENT_ID;
  delete env.JWXT_PASSWORD;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: projectRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    for (let i = 0; i < 50 && !output.includes("API running"); i += 1) {
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.strictEqual(output.includes("API running"), true, output);
    return output;
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const production = await captureStartup("production", 3474);
  assert.strictEqual(production.includes("[scheduler] disabled in production"), true);
  assert.strictEqual(production.includes("[调度] 启动定时任务"), false);
  console.log("productionLegacySchedulerDisabledTest=passed");

  const development = await captureStartup("development", 3475);
  assert.strictEqual(development.includes("[调度] 启动定时任务"), true);
  console.log("developmentLegacySchedulerEnabledTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
