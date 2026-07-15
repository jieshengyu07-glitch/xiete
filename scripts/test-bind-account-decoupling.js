const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const root = path.resolve(__dirname, "..");
const preload = path.join(__dirname, "fixtures", "mock-bind-login.js");
const jwtSecret = "bind-flow-jwt-secret-0123456789-abcdef";
const credentialSecret = "bind-flow-credential-secret-0123456789-abcdef";

function request(port, method, pathname, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = { "Content-Type": "application/json" };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    if (token) headers.Authorization = "Bearer " + token;
    const req = http.request({ hostname: "127.0.0.1", port, method, path: pathname, headers }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, data: text ? JSON.parse(text) : {} }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("mock server exited early");
    try {
      const result = await request(port, "GET", "/health");
      if (result.status === 200) return;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("mock server start timeout");
}

async function runCase(mode, callback) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-bind-" + mode + "-"));
  const port = 4300 + Math.floor(Math.random() * 300);
  const userId = "bind-test-" + mode;
  const env = Object.assign({}, process.env, {
    NODE_ENV: "development",
    DATA_DIR: dataDir,
    JWT_SECRET: jwtSecret,
    CREDENTIAL_SECRET: credentialSecret,
    DISABLE_SCHEDULER: "1",
    MOCK_BIND_MODE: mode,
    PORT: String(port)
  });
  const child = spawn(process.execPath, ["-r", preload, "src/index.js"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
  try {
    await waitForServer(port, child);
    const token = jwt.sign({ userId }, jwtSecret, { expiresIn: "5m" });
    await callback({ port, token, dataDir, userId });
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function waitForStatus(port, token, expected, attempts) {
  let latest;
  for (let index = 0; index < (attempts || 30); index += 1) {
    latest = await request(port, "GET", "/status", token);
    if (latest.data.campusLoginStatus === expected) return latest;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return latest;
}

async function main() {
  await runCase("normal", async ({ port, token, dataDir, userId }) => {
    const bound = await request(port, "POST", "/bind-account", token, { studentId: "student", password: "correct" });
    assert.strictEqual(bound.status, 200);
    assert.strictEqual(bound.data.bound, true);
    assert.strictEqual(bound.data.campusLoginStatus, "valid");
    const status = await waitForStatus(port, token, "valid");
    assert.strictEqual(status.data.campusLoginStatus, "valid");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "account.json")), true);
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "cookies.json")), true);
    console.log("correctAccountJwxtAvailableBindSuccessTest=passed");
    console.log("boundAccountJwxtRecoveryWritesCookiesTest=passed");
  });

  await runCase("down", async ({ port, token, dataDir, userId }) => {
    const bound = await request(port, "POST", "/bind-account", token, { studentId: "student", password: "correct" });
    assert.strictEqual(bound.status, 200);
    assert.strictEqual(bound.data.bound, true);
    assert.strictEqual(bound.data.campusLoginStatus, "recovering");
    await new Promise(resolve => setTimeout(resolve, 250));
    const status = await request(port, "GET", "/status", token);
    assert.strictEqual(status.data.bound, true);
    assert.strictEqual(status.data.campusLoginStatus, "recovering");
    assert.notStrictEqual(status.data.lastJwxtError, "ACCOUNT_RELOGIN_REQUIRED");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "account.json")), true);
    console.log("correctAccountJwxtUnavailableStillBoundTest=passed");
  });

  await runCase("recover", async ({ port, token, dataDir, userId }) => {
    const bound = await request(port, "POST", "/bind-account", token, { studentId: "student", password: "correct" });
    assert.strictEqual(bound.status, 200);
    assert.strictEqual(bound.data.bound, true);
    assert.strictEqual(bound.data.campusLoginStatus, "recovering");
    const status = await waitForStatus(port, token, "valid");
    assert.strictEqual(status.data.campusLoginStatus, "valid");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "cookies.json")), true);
    console.log("boundAccountAutomaticJwxtRecoveryTest=passed");
  });

  await runCase("invalid", async ({ port, token, dataDir, userId }) => {
    const bound = await request(port, "POST", "/bind-account", token, { studentId: "student", password: "wrong" });
    assert.strictEqual(bound.status, 400);
    assert.strictEqual(bound.data.success, false);
    assert.strictEqual(bound.data.error, "INVALID_CREDENTIALS");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", userId, "account.json")), false);
    console.log("invalidPasswordBindFailureTest=passed");
  });
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
