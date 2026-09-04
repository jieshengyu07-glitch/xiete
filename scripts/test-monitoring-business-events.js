const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { createBusinessEventRecorder } = require("../src/services/businessEventRecorder");

function request(server, route) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: route }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }

async function withServer(app, run) {
  const server = await new Promise(resolve => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try { await run(server); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function main() {
  const events = [];
  const recorder = createBusinessEventRecorder({
    repository: { insertMonitorEvent: event => { events.push(event); } },
    identity: { userDayHash: value => value ? "b".repeat(64) : null }
  });
  const app = express();
  app.use((req, res, next) => { req.userId = "raw-identity-must-not-reach-repository"; next(); });
  app.get("/success", recorder.monitorBusinessEvent("grades_query", { source: "cache" }), (req, res) => {
    res.json({ success: true, password: "must-not-be-stored" });
  });
  app.get("/failure", recorder.monitorBusinessEvent("bind_account", { source: "jwxt" }), (req, res) => {
    res.status(400).json({ success: false, error: "INVALID_CREDENTIALS", message: "must-not-be-stored" });
  });
  app.get("/server-error", recorder.monitorBusinessEvent("unbind_account", { source: "unknown" }), (req, res) => {
    res.status(500).json({ success: false, message: "must-not-be-stored" });
  });
  await withServer(app, async server => {
    assert.strictEqual((await request(server, "/success")).status, 200);
    assert.strictEqual((await request(server, "/failure")).status, 400);
    assert.strictEqual((await request(server, "/server-error")).status, 500);
    await nextTurn();
  });
  assert.strictEqual(events.length, 3);
  assert.deepStrictEqual(events.map(event => event.eventType), ["grades_query", "bind_account", "unbind_account"]);
  assert.strictEqual(events[0].success, true);
  assert.strictEqual(events[0].errorType, null);
  assert.strictEqual(events[1].success, false);
  assert.strictEqual(events[1].errorType, "INVALID_CREDENTIALS");
  assert.strictEqual(events[2].errorType, "INTERNAL_ERROR");
  assert.ok(events.every(event => Number.isInteger(event.durationMs) && event.durationMs >= 0));
  assert.ok(events.every(event => event.userDayHash === "b".repeat(64)));
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("raw-identity"));
  assert.ok(!serialized.includes("must-not-be-stored"));

  let writes = 0;
  let failures = 0;
  let unhandled = null;
  const failureRecorder = createBusinessEventRecorder({
    repository: {
      insertMonitorEvent() {
        writes += 1;
        if (writes === 1) return Promise.reject(new Error("private rejection"));
        throw new Error("private synchronous failure");
      }
    },
    identity: { userDayHash: () => null },
    onWriteFailure: () => { failures += 1; }
  });
  const failureApp = express();
  failureApp.get("/business", failureRecorder.monitorBusinessEvent("wechat_login", { source: "wechat" }), (req, res) => {
    res.status(202).json({ code: 0, data: { unchanged: true } });
  });
  const onUnhandled = reason => { unhandled = reason; };
  process.on("unhandledRejection", onUnhandled);
  try {
    await withServer(failureApp, async server => {
      const first = await request(server, "/business");
      const second = await request(server, "/business");
      assert.strictEqual(first.status, 202);
      assert.strictEqual(second.status, 202);
      assert.deepStrictEqual(JSON.parse(first.body), { code: 0, data: { unchanged: true } });
      await nextTurn();
      await nextTurn();
    });
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
  assert.strictEqual(failures, 2);
  assert.strictEqual(unhandled, null);

  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const expectedWiring = [
    ["/auth/wechat-login", "wechat_login"],
    ["/bind-account", "bind_account"],
    ["/unbind-account", "unbind_account"],
    ["/grades", "grades_query"],
    ["/check", "grades_query"],
    ["/timetable/today", "timetable_query"],
    ["/timetable/week", "timetable_query"],
    ["/timetable/sync", "timetable_query"]
  ];
  expectedWiring.forEach(([route, eventType]) => {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(serverSource, new RegExp("app\\.(?:get|post)\\(\\\"" + escaped + "\\\"[^\\n]+monitorBusinessEvent\\(\\\"" + eventType + "\\\""));
  });
  assert.strictEqual((serverSource.match(/monitorBusinessEvent\("grades_query"/g) || []).length, 2);
  assert.strictEqual((serverSource.match(/monitorBusinessEvent\("timetable_query"/g) || []).length, 3);
  console.log("monitoringBusinessEventSemanticsTest=passed");
  console.log("monitoringBusinessEventFailureIsolationTest=passed");
  console.log("monitoringBusinessRouteWiringTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
