const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

process.env.NODE_ENV = "development";

const root = path.resolve(__dirname, "..");
const jwtSecret = "review-demo-jwt-secret-0123456789-abcdef";
const credentialSecret = "review-demo-credential-secret-0123456789-abcdef";
const demoUsername = "review-auditor";
const demoPassword = "Review-Only-Password-2026!";

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
      res.on("end", () => {
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (err) {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("review demo server exited early");
    try {
      const health = await request(port, "GET", "/health");
      if (health.status === 200) return;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("review demo server start timeout");
}

function configValidationTest() {
  const reviewDemo = require("../src/services/reviewDemo");
  const original = {
    enabled: process.env.REVIEW_DEMO_ENABLED,
    username: process.env.REVIEW_DEMO_USERNAME,
    password: process.env.REVIEW_DEMO_PASSWORD
  };
  try {
    delete process.env.REVIEW_DEMO_ENABLED;
    delete process.env.REVIEW_DEMO_USERNAME;
    delete process.env.REVIEW_DEMO_PASSWORD;
    assert.strictEqual(reviewDemo.classifyCredentials("review-auditor", demoPassword), "unavailable");
    assert.strictEqual(reviewDemo.classifyCredentials("202600000001", demoPassword), "none");
    console.log("disabledReviewAccountNeverFallsThroughToCampusLoginTest=passed");

    process.env.REVIEW_DEMO_ENABLED = "true";
    process.env.REVIEW_DEMO_USERNAME = "review-user";
    process.env.REVIEW_DEMO_PASSWORD = "short";
    assert.throws(() => reviewDemo.assertReviewDemoConfig(), err => err && err.code === "REVIEW_DEMO_CONFIG_INVALID");
    process.env.REVIEW_DEMO_PASSWORD = demoPassword;
    assert.strictEqual(reviewDemo.assertReviewDemoConfig(), true);
    assert.strictEqual(reviewDemo.classifyCredentials("review-other", demoPassword), "invalid");
    console.log("reviewDemoStrongEnvironmentConfigTest=passed");
  } finally {
    if (original.enabled === undefined) delete process.env.REVIEW_DEMO_ENABLED;
    else process.env.REVIEW_DEMO_ENABLED = original.enabled;
    if (original.username === undefined) delete process.env.REVIEW_DEMO_USERNAME;
    else process.env.REVIEW_DEMO_USERNAME = original.username;
    if (original.password === undefined) delete process.env.REVIEW_DEMO_PASSWORD;
    else process.env.REVIEW_DEMO_PASSWORD = original.password;
  }
}

async function main() {
  configValidationTest();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-demo-isolation-"));
  const port = 44500 + Math.floor(Math.random() * 300);
  const demoUserId = "review-demo-user";
  const wrongPasswordUserId = "review-demo-wrong-password";
  const normalUserId = "review-demo-normal-user";
  const conflictUserId = "review-demo-existing-data-user";
  const demoToken = jwt.sign({ userId: demoUserId }, jwtSecret, { expiresIn: "5m" });
  const wrongToken = jwt.sign({ userId: wrongPasswordUserId }, jwtSecret, { expiresIn: "5m" });
  const normalToken = jwt.sign({ userId: normalUserId }, jwtSecret, { expiresIn: "5m" });
  const conflictToken = jwt.sign({ userId: conflictUserId }, jwtSecret, { expiresIn: "5m" });
  const env = Object.assign({}, process.env, {
    NODE_ENV: "development",
    DATA_DIR: dataDir,
    JWT_SECRET: jwtSecret,
    CREDENTIAL_SECRET: credentialSecret,
    DISABLE_SCHEDULER: "1",
    REVIEW_DEMO_ENABLED: "true",
    REVIEW_DEMO_USERNAME: demoUsername,
    REVIEW_DEMO_PASSWORD: demoPassword,
    PORT: String(port)
  });

  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "inherit"]
  });

  try {
    await waitForServer(port, child);

    const wrong = await request(port, "POST", "/bind-account", wrongToken, {
      studentId: demoUsername,
      password: "incorrect-review-password"
    });
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual(wrong.data.error, "INVALID_CREDENTIALS");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", wrongPasswordUserId, "review-demo.json")), false);
    console.log("reviewDemoWrongPasswordRejectedTest=passed");

    const imported = await request(port, "POST", "/grades/import", conflictToken, {
      grades: [{ courseName: "Existing private grade", score: "99" }]
    });
    assert.strictEqual(imported.status, 200);
    const conflict = await request(port, "POST", "/bind-account", conflictToken, {
      studentId: demoUsername,
      password: demoPassword
    });
    assert.strictEqual(conflict.status, 409);
    assert.strictEqual(conflict.data.error, "REVIEW_DEMO_ACCOUNT_CONFLICT");
    assert.strictEqual(fs.existsSync(path.join(dataDir, "users", conflictUserId, "review-demo.json")), false);
    console.log("reviewDemoCannotMaskExistingCampusDataTest=passed");

    const bound = await request(port, "POST", "/bind-account", demoToken, {
      studentId: demoUsername,
      password: demoPassword
    });
    assert.strictEqual(bound.status, 200);
    assert.strictEqual(bound.data.reviewDemo, true);
    assert.strictEqual(bound.data.campusLoginStatus, "valid");

    const userDir = path.join(dataDir, "users", demoUserId);
    const markerPath = path.join(userDir, "review-demo.json");
    assert.strictEqual(fs.existsSync(markerPath), true);
    assert.strictEqual(fs.existsSync(path.join(userDir, "account.json")), false);
    assert.strictEqual(fs.existsSync(path.join(userDir, "cookies.json")), false);
    const markerText = fs.readFileSync(markerPath, "utf8");
    assert.strictEqual(markerText.includes(demoUsername), false);
    assert.strictEqual(markerText.includes(demoPassword), false);
    console.log("reviewDemoCreatesMarkerWithoutCredentialsTest=passed");

    const status = await request(port, "GET", "/status", demoToken);
    assert.strictEqual(status.data.reviewDemo, true);
    assert.strictEqual(status.data.bound, true);
    assert.strictEqual(status.data.campusLoginStatus, "valid");

    const grades = await request(port, "GET", "/grades", demoToken);
    assert.strictEqual(grades.status, 200);
    assert.strictEqual(grades.data.reviewDemo, true);
    assert.strictEqual(grades.data.syncing, false);
    assert(grades.data.grades.length >= 4);
    assert(grades.data.grades.every(item => item.source === "review_demo"));
    assert.strictEqual(JSON.stringify(grades.data).includes(demoUsername), false);
    assert.strictEqual(JSON.stringify(grades.data).includes(demoPassword), false);

    const today = await request(port, "GET", "/timetable/today", demoToken);
    assert.strictEqual(today.data.reviewDemo, true);
    assert.strictEqual(today.data.syncing, false);
    assert.strictEqual(today.data.sections.length, 4);
    assert(today.data.sections.some(section => section.courses.length > 0));

    const week = await request(port, "GET", "/timetable/week", demoToken);
    assert.strictEqual(week.data.reviewDemo, true);
    assert.strictEqual(week.data.days.length, 7);
    assert(week.data.days.some(day => day.sections.some(section => section.courses.length > 0)));

    const check = await request(port, "POST", "/check", demoToken, {});
    assert.strictEqual(check.data.reviewDemo, true);
    assert.strictEqual(check.data.syncing, false);

    const sync = await request(port, "POST", "/timetable/sync", demoToken, {});
    assert.strictEqual(sync.data.reviewDemo, true);
    assert.strictEqual(sync.data.syncing, false);

    const forbidden = await request(port, "POST", "/grades/import", demoToken, { grades: [{ courseName: "private" }] });
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(forbidden.data.error, "REVIEW_DEMO_ISOLATED");
    console.log("reviewDemoNeverCallsRealCampusStorageTest=passed");

    const normalGrades = await request(port, "GET", "/grades", normalToken);
    assert.strictEqual(normalGrades.status, 200);
    assert.strictEqual(normalGrades.data.reviewDemo, undefined);
    assert.strictEqual(normalGrades.data.grades.length, 0);
    assert.strictEqual(JSON.stringify(normalGrades.data).includes("高等数学（示例）"), false);
    console.log("reviewDemoDoesNotLeakToNormalUsersTest=passed");

    const deleted = await request(port, "DELETE", "/account/data", demoToken);
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual(deleted.data.success, true);
    assert.strictEqual(fs.existsSync(userDir), false);
    console.log("reviewDemoCloudDeletionTest=passed");
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
