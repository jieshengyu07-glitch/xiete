const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

process.env.NODE_ENV = "development";
process.env.JWT_SECRET = "grade-isolation-jwt-secret-0123456789-abcdef";
process.env.CREDENTIAL_SECRET = process.env.CREDENTIAL_SECRET || "grade-isolation-credential-secret-0123456789-abcdef";

const { signToken } = require("../src/utils/jwt");
const persistence = require("../src/services/userPersistence");
const credentialStore = require("../src/services/credentialStore");
const { getUserPaths } = require("../src/services/userPaths");

const userA = "grade-isolation-user-a";
const userB = "grade-isolation-user-b";
const tokenA = signToken({ userId: userA });
const tokenB = signToken({ userId: userB });
const port = 43000 + Math.floor(Math.random() * 1000);

function request(method, route, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: token ? { Authorization: "Bearer " + token } : {}
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch (err) {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("test server exited early");
    try {
      const health = await request("GET", "/health");
      if (health.status === 200) return;
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
}

async function main() {
  persistence.saveGradesCache(userA, [{ courseName: "User A Private Grade", score: "96" }]);
  credentialStore.saveBoundAccount("student-a", "private-password", userA);

  const child = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
    cwd: path.resolve(__dirname, ".."),
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ["ignore", "ignore", "inherit"]
  });

  try {
    await waitForServer(child);

    const anonymous = await request("GET", "/grades");
    assert.strictEqual(anonymous.status, 401);
    assert.strictEqual(anonymous.data.error, "UNAUTHORIZED");
    console.log("anonymousGradesRequestReturns401Test=passed");

    const aGrades = await request("GET", "/grades", tokenA);
    assert.strictEqual(aGrades.status, 200);
    assert.strictEqual(aGrades.data.grades.length, 1);

    const bGrades = await request("GET", "/grades", tokenB);
    assert.strictEqual(bGrades.status, 200);
    assert.strictEqual(bGrades.data.grades.length, 0);
    assert.strictEqual(JSON.stringify(bGrades.data).includes("User A Private Grade"), false);
    console.log("authenticatedUserGradeIsolationTest=passed");

    const deleted = await request("DELETE", "/account/data", tokenA);
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual(deleted.data.success, true);
    assert.strictEqual(deleted.data.deleted, true);
    assert.strictEqual(fs.existsSync(getUserPaths(userA).userDir), false);

    const afterDelete = await request("GET", "/grades", tokenA);
    assert.strictEqual(afterDelete.status, 200);
    assert.strictEqual(afterDelete.data.grades.length, 0);
    assert.strictEqual(fs.existsSync(getUserPaths(userA).accountPath), false);
    console.log("deleteUserDataRemovesGradesAndAccountTest=passed");
  } finally {
    child.kill();
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
