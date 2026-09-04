const assert = require("assert");
const http = require("http");
const express = require("express");
const requestMetrics = require("../src/middleware/requestMetrics");

function request(server, options) {
  const address = server.address();
  const input = options || {};
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      method: input.method || "GET",
      path: input.path || "/",
      headers: input.headers || {}
    }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

async function withServer(app, run) {
  const server = await new Promise(resolve => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const metrics = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = "must-not-be-stored"; next(); });
  app.use(requestMetrics({ insertRequestMetric: metric => { metrics.push(metric); } }));
  app.get("/test", (req, res) => res.json({ ok: true }));
  app.get("/test/:id", (req, res) => res.json({ id: req.params.id }));
  app.post("/sensitive", (req, res) => res.json({ ok: true }));
  app.get("/failure", (req, res) => res.status(503).json({ ok: false }));
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/admin/metrics", (req, res) => res.json({ ok: true }));
  app.get("/admin/dashboard", (req, res) => res.send("dashboard"));
  app.get("/admin/health", (req, res) => res.json({ ok: true }));

  await withServer(app, async server => {
    assert.strictEqual((await request(server, { path: "/test" })).status, 200);
    assert.strictEqual((await request(server, {
      path: "/test/123?secret=DO_NOT_STORE",
      headers: { Authorization: "Bearer test-token", Cookie: "session=test-cookie" }
    })).status, 200);
    assert.strictEqual((await request(server, {
      method: "POST",
      path: "/sensitive?token=query-secret",
      headers: { "Content-Type": "application/json", Authorization: "Bearer body-test-token" },
      body: JSON.stringify({ password: "body-secret" })
    })).status, 200);
    assert.strictEqual((await request(server, { path: "/failure" })).status, 503);
    assert.strictEqual((await request(server, { path: "/this/should/not/be/stored/123?token=secret" })).status, 404);
    assert.strictEqual((await request(server, { path: "/health" })).status, 200);
    assert.strictEqual((await request(server, { path: "/admin/metrics" })).status, 200);
    assert.strictEqual((await request(server, { path: "/admin/dashboard" })).status, 200);
    assert.strictEqual((await request(server, { path: "/admin/health" })).status, 200);
    assert.strictEqual((await request(server, { method: "OPTIONS", path: "/test" })).status, 200);
    await nextTurn();
  });

  assert.strictEqual(metrics.length, 5);
  assert.deepStrictEqual(Object.keys(metrics[0]).sort(), [
    "method", "occurredAt", "responseTimeMs", "route", "statusCode"
  ]);
  assert.strictEqual(metrics[0].method, "GET");
  assert.strictEqual(metrics[0].route, "/test");
  assert.strictEqual(metrics[0].statusCode, 200);
  assert.ok(metrics[0].responseTimeMs >= 0);
  assert.strictEqual(metrics[1].route, "/test/:id");
  assert.strictEqual(metrics[2].route, "/sensitive");
  assert.strictEqual(metrics[3].statusCode, 503);
  assert.strictEqual(metrics[4].route, "__unmatched__");
  const serialized = JSON.stringify(metrics);
  ["123", "DO_NOT_STORE", "test-token", "test-cookie", "must-not-be-stored", "query-secret", "body-secret"].forEach(value => {
    assert.ok(!serialized.includes(value));
  });

  let failureLogs = 0;
  let unhandled = null;
  const onUnhandled = reason => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);
  try {
    const failureApp = express();
    let writeAttempts = 0;
    failureApp.use(requestMetrics({
      insertRequestMetric: () => {
        writeAttempts += 1;
        if (writeAttempts === 1) return Promise.reject(new Error("sensitive database detail"));
        throw new Error("sensitive synchronous detail");
      },
      onWriteFailure: () => { failureLogs += 1; }
    }));
    failureApp.get("/business", (req, res) => res.status(201).json({ ok: true }));
    await withServer(failureApp, async server => {
      const response = await request(server, { path: "/business" });
      assert.strictEqual(response.status, 201);
      const secondResponse = await request(server, { path: "/business" });
      assert.strictEqual(secondResponse.status, 201);
      await nextTurn();
      await nextTurn();
    });
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
  assert.strictEqual(failureLogs, 2);
  assert.strictEqual(unhandled, null);
  console.log("requestMetricsMiddlewareTest=passed");
  console.log("requestMetricsPrivacyGuardTest=passed");
  console.log("requestMetricsFailureIsolationTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
