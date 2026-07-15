const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const projectRoot = path.resolve(__dirname, "..");
const jwtSecret = "debug-route-test-jwt-secret-0123456789-ABCDE";
const credentialSecret = "debug-route-test-credential-secret-0123456789";

function request(port, method, pathname, token, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers = { "Content-Type": "application/json" };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    if (token) headers.Authorization = "Bearer " + token;
    Object.assign(headers, extraHeaders || {});
    const req = http.request({ hostname: "127.0.0.1", port, method, path: pathname, headers }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port, child, output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("server exited before health check: " + output());
    try {
      const response = await request(port, "GET", "/health");
      if (response.status === 200) return;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server health check timed out: " + output());
}

async function withServer(options, run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-debug-route-"));
  const env = Object.assign({}, process.env, {
    NODE_ENV: options.nodeEnv,
    DATA_DIR: dataDir,
    JWT_SECRET: jwtSecret,
    CREDENTIAL_SECRET: credentialSecret,
    WECHAT_APPID: "debug-route-test-appid",
    WECHAT_SECRET: "debug-route-test-secret",
    DISABLE_SCHEDULER: "1",
    PORT: String(options.port)
  });
  delete env.COOKIES_JSON;
  delete env.JWXT_STUDENT_ID;
  delete env.JWXT_PASSWORD;
  if (options.adminMode === undefined) delete env.ADMIN_MODE;
  else env.ADMIN_MODE = options.adminMode;
  if (options.adminDiagnosticSecret === undefined) delete env.ADMIN_DIAGNOSTIC_SECRET;
  else env.ADMIN_DIAGNOSTIC_SECRET = options.adminDiagnosticSecret;

  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: projectRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });

  try {
    await waitForServer(options.port, child, () => stdout + stderr);
    await run(options.port);
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "weapp", "app.json"), "utf8"));
  const settingsWxml = fs.readFileSync(path.join(projectRoot, "weapp", "pages", "settings", "settings.wxml"), "utf8");
  assert.strictEqual(appConfig.pages.includes("pages/xg-session/index"), false);
  assert.strictEqual(settingsWxml.includes("toggleDebug"), false);
  assert.strictEqual(settingsWxml.includes("apiBase"), false);
  console.log("miniProgramDebugSurfaceRemovedTest=passed");

  const token = jwt.sign({ userId: "debug-route-test-user" }, jwtSecret, { expiresIn: "5m" });
  const diagnosticSecret = "debug-route-admin-diagnostic-secret-0123456789";
  await withServer({ nodeEnv: "production", adminDiagnosticSecret: diagnosticSecret, port: 3471 }, async port => {
    for (const pathname of ["/upload-cookies", "/upload-xg-session"]) {
      const response = await request(port, "POST", pathname, token, {});
      assert.strictEqual(response.status, 404);
    }
    const diagnostic = await request(port, "GET", "/admin/diagnose-data", null, undefined, {
      "x-admin-diagnostic-key": diagnosticSecret
    });
    assert.strictEqual(diagnostic.status, 404);
    console.log("productionDefaultDebugRoutes404Test=passed");
  });

  await withServer({ nodeEnv: "production", adminMode: "true", adminDiagnosticSecret: diagnosticSecret, port: 3472 }, async port => {
    for (const pathname of ["/upload-cookies", "/upload-xg-session"]) {
      const response = await request(port, "POST", pathname, token, {});
      assert.strictEqual(response.status, 400);
    }
    const diagnostic = await request(port, "GET", "/admin/diagnose-data", null, undefined, {
      "x-admin-diagnostic-key": diagnosticSecret
    });
    assert.strictEqual(diagnostic.status, 200);
    console.log("productionAdminModeDebugRoutesEnabledTest=passed");
  });

  await withServer({ nodeEnv: "development", port: 3473 }, async port => {
    for (const pathname of ["/upload-cookies", "/upload-xg-session"]) {
      const response = await request(port, "POST", pathname, token, {});
      assert.strictEqual(response.status, 400);
    }
    console.log("developmentDebugRoutesEnabledTest=passed");
  });
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
