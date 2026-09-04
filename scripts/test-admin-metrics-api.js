const assert = require("assert");
const http = require("http");
const express = require("express");
const { createAdminRouter } = require("../src/admin/routes");
const { createAdminMetricsService } = require("../src/services/adminMetrics");

const SECRET = "dashboard-test-secret-0123456789-abcdef";

function request(server, path, key) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, headers: key ? { "X-Admin-Dashboard-Key": key } : {} }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body, json: JSON.parse(body) }));
    });
    req.on("error", reject); req.end();
  });
}

async function main() {
  const calls = [];
  const repository = {
    async getRequestSummary(input) { calls.push(["requests", input]); return { requestCount: 9, averageResponseTimeMs: null, p95ResponseTimeMs: 42.25 }; },
    async getDailyUserSummary(input) { calls.push(["users", input]); return { uniqueUsersToday: 3, activeUsersLast5Minutes: 1 }; },
    async getEventSummary(input) { calls.push(["events", input]); return [{ eventType: "grades_query", total: 2, success: 1, failure: 1 }]; },
    async getRequestTimeseries(input) { calls.push(["series", input]); return [{ timestamp: new Date("2026-09-04T03:59:00Z"), requestCount: 2, averageResponseTimeMs: 10, p95ResponseTimeMs: 14 }]; },
    async getErrorSummary(input) { calls.push(["errors", input]); return [{ eventType: "grades_query", errorType: "JWXT_TIMEOUT", count: 2, lastOccurredAt: new Date("2026-09-04T03:50:00Z"), userDayHash: "forbidden", message: "forbidden" }]; },
    async checkPostgresHealth() { calls.push(["health"]); }
  };
  const service = createAdminMetricsService({ repository, now: () => new Date("2026-09-04T04:00:00Z"), uptime: () => 125.9, healthTimeoutMs: 100 });
  const app = express(); app.use("/admin", createAdminRouter({ environment: { ADMIN_DASHBOARD_SECRET: SECRET }, service }));
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  try {
    assert.strictEqual((await request(server, "/admin/metrics/summary")).status, 404);
    const summary = await request(server, "/admin/metrics/summary", SECRET);
    assert.strictEqual(summary.status, 200); assert.strictEqual(summary.headers["cache-control"], "no-store");
    assert.strictEqual(summary.headers["x-ratelimit-limit"], "120");
    assert.deepStrictEqual(summary.json.today, { uniqueUsers: 3, activeUsers5m: 1, requestCount: 9, averageResponseTimeMs: 0, p95ResponseTimeMs: 42.3 });
    assert.deepStrictEqual(summary.json.events.wechatLogin, { total: 0, success: 0, failure: 0 });
    assert.deepStrictEqual(summary.json.events.gradesQuery, { total: 2, success: 1, failure: 1 });
    const bounds = calls.find(call => call[0] === "users")[1];
    assert.strictEqual(bounds.dayStart.toISOString(), "2026-09-03T16:00:00.000Z"); assert.strictEqual(bounds.dayEnd.toISOString(), "2026-09-04T16:00:00.000Z");
    const series = await request(server, "/admin/metrics/timeseries?range=60m&bucket=minute", SECRET);
    assert.strictEqual(series.status, 200); assert.ok(series.json.points.length <= 300); assert.ok(series.json.points.some(point => point.requestCount === 0));
    assert.strictEqual((await request(server, "/admin/metrics/timeseries?range=6h&bucket=5minute", SECRET)).status, 200);
    const daySeries = await request(server, "/admin/metrics/timeseries?range=24h&bucket=5minute", SECRET); assert.strictEqual(daySeries.status, 200); assert.ok(daySeries.json.points.length <= 300);
    assert.strictEqual((await request(server, "/admin/metrics/timeseries?range=24h&bucket=minute", SECRET)).status, 400);
    assert.strictEqual((await request(server, "/admin/metrics/timeseries?range=7d&bucket=hour", SECRET)).status, 400);
    assert.strictEqual((await request(server, "/admin/metrics/timeseries?range=60m&bucket=second", SECRET)).status, 400);
    const errors = await request(server, "/admin/metrics/errors?limit=20", SECRET);
    assert.strictEqual(errors.status, 200); assert.strictEqual(errors.json.errors[0].errorType, "JWXT_TIMEOUT");
    assert.ok(!errors.body.includes("userDayHash") && !errors.body.includes("forbidden") && !errors.body.includes("message"));
    assert.strictEqual((await request(server, "/admin/metrics/errors?limit=51", SECRET)).status, 400);
    const health = await request(server, "/admin/health", SECRET); assert.strictEqual(health.status, 200); assert.strictEqual(health.json.postgres.status, "ok"); assert.deepStrictEqual(health.json.service, { status: "ok", uptimeSeconds: 125 });
  } finally { await new Promise(resolve => server.close(resolve)); }

  const failed = createAdminMetricsService({ repository: { checkPostgresHealth: async () => { throw new Error("raw database secret"); } }, healthTimeoutMs: 10 });
  assert.deepStrictEqual((await failed.health()).postgres.status, "error");
  const empty = createAdminMetricsService({
    repository: {
      getRequestSummary: async () => ({ requestCount: 0, averageResponseTimeMs: null, p95ResponseTimeMs: null }),
      getDailyUserSummary: async () => ({ uniqueUsersToday: 0, activeUsersLast5Minutes: 0 }),
      getEventSummary: async () => []
    },
    now: () => new Date("2026-09-04T04:00:00Z")
  });
  const emptySummary = await empty.summary();
  assert.deepStrictEqual(emptySummary.today, { uniqueUsers: 0, activeUsers5m: 0, requestCount: 0, averageResponseTimeMs: 0, p95ResponseTimeMs: 0 });
  assert.strictEqual(JSON.stringify(emptySummary).includes("NaN"), false);
  console.log("adminMetricsSummaryAndShanghaiBoundaryTest=passed");
  console.log("adminMetricsTimeseriesWhitelistAndZeroFillTest=passed");
  console.log("adminMetricsPrivacyAndHealthTest=passed");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
