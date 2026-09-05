const assert = require("assert");
const { createMonitoringRepository } = require("../src/repositories/monitoringRepository");
const { createAdminMetricsService } = require("../src/services/adminMetrics");

async function main() {
  const calls = [];
  const db = { async query(query) {
    calls.push(query);
    if (/FROM users/.test(query.text)) return { rows: [{ registered_user_count: "17" }] };
    if (/FROM jwxt_bindings/.test(query.text)) return { rows: [{ bound_user_count: "11" }] };
    if (/FROM api_request_metrics/.test(query.text)) return { rows: [{ request_count: "41", average_response_time_ms: "18.25", p95_response_time_ms: "39.5", first_occurred_at: "2026-08-31T17:00:00Z" }] };
    if (/FROM monitor_events/.test(query.text)) return { rows: [
      { event_type: "grades_query", total: "12", success_count: "10", failure_count: "2", first_occurred_at: "2026-08-31T16:30:00Z" },
      { event_type: "wechat_login", total: "5", success_count: "5", failure_count: "0", first_occurred_at: "2026-09-01T00:00:00Z" }
    ] };
    throw new Error("unexpected query");
  } };
  const repository = createMonitoringRepository(() => db);
  const until = new Date("2026-09-04T04:00:00Z");
  const requests = await repository.getLifetimeRequestSummary({ until });
  const events = await repository.getLifetimeEventSummary({ until });
  const registeredUsers = await repository.getRegisteredUserCount();
  const boundUsers = await repository.getBoundUserCount();
  assert.deepStrictEqual(requests, { requestCount: 41, averageResponseTimeMs: 18.25, p95ResponseTimeMs: 39.5, firstOccurredAt: new Date("2026-08-31T17:00:00Z") });
  assert.strictEqual(events.firstOccurredAt.toISOString(), "2026-08-31T16:30:00.000Z");
  assert.strictEqual(events.events[0].failure, 2);
  assert.strictEqual(registeredUsers, 17);
  assert.strictEqual(boundUsers, 11);
  assert.ok(calls.every(call => call.query_timeout === 5000));
  assert.match(calls[0].text, /percentile_cont\(0\.95\)/);
  assert.ok(!/occurred_at\s*>=/i.test(calls[0].text + calls[1].text));
  assert.ok(calls[0].text.includes("occurred_at <= $1") && calls[1].text.includes("occurred_at <= $1"));
  assert.strictEqual(calls[2].text.replace(/\s+/g, " ").trim(), "SELECT COUNT(*) AS registered_user_count FROM users");
  assert.deepStrictEqual(calls[2].values, []);
  assert.ok(!/openid|student_id|jwxt_bindings|\bJOIN\b/i.test(calls[2].text));
  assert.strictEqual(calls[3].text.replace(/\s+/g, " ").trim(), "SELECT COUNT(*) AS bound_user_count FROM jwxt_bindings");
  assert.deepStrictEqual(calls[3].values, []);
  assert.ok(!/student_id|password_enc|openid|user_id|last_jwxt_error|last_jwxt_error_message|SELECT\s+\*/i.test(calls[3].text));

  const requestOnlyService = createAdminMetricsService({
    repository: {
      getRequestSummary: async () => ({ requestCount: 0, averageResponseTimeMs: null, p95ResponseTimeMs: null }),
      getDailyUserSummary: async () => ({ uniqueUsersToday: 0, activeUsersLast5Minutes: 0 }),
      getEventSummary: async () => [],
      getLifetimeRequestSummary: async () => ({ requestCount: 1, averageResponseTimeMs: 4, p95ResponseTimeMs: 4, firstOccurredAt: new Date("2026-09-01T01:00:00Z") }),
      getLifetimeEventSummary: async () => ({ events: [], firstOccurredAt: null }),
      getRegisteredUserCount: async () => 100,
      getBoundUserCount: async () => 80
    },
    now: () => until
  });
  const requestOnlySummary = await requestOnlyService.summary();
  assert.strictEqual(requestOnlySummary.lifetime.monitoringStartedAt, "2026-09-01T01:00:00.000Z");
  assert.strictEqual(requestOnlySummary.lifetime.boundUsers, 80);
  assert.strictEqual(requestOnlySummary.lifetime.bindingRate, 80);
  console.log("lifetimePostgresAggregationTest=passed");
  console.log("registeredUsersCountOnlyPrivacyTest=passed");
  console.log("boundUsersCountOnlyPrivacyAndRateTest=passed");
  console.log("monitoringStartedAtEarliestAvailableTest=passed");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
