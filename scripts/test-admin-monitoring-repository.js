const assert = require("assert");
const { createMonitoringRepository } = require("../src/repositories/monitoringRepository");

async function main() {
  const calls = [];
  const db = { async query(query, legacyValues) {
    const sql = typeof query === "string" ? query : query.text;
    const values = typeof query === "string" ? legacyValues : query.values;
    calls.push({ sql, values, queryTimeout: typeof query === "string" ? null : query.query_timeout });
    if (/AS http_2xx/.test(sql) && !/GROUP BY bucket_at/.test(sql)) return { rows: [{ http_2xx: "4", http_3xx: "1", http_4xx: "3", http_5xx: "2" }] };
    if (/GROUP BY event_type, error_type/.test(sql)) return { rows: [{ event_type: "grades_query", error_type: "JWXT_TIMEOUT", error_count: "2", last_occurred_at: "2026-09-04T03:50:00Z" }] };
    if (/GROUP BY event_type/.test(sql)) return { rows: [{ event_type: "grades_query", total: "3", success_count: "2", failure_count: "1" }] };
    if (/GROUP BY bucket_at/.test(sql)) return { rows: [{ bucket_at: "2026-09-04T03:55:00Z", request_count: "4", http_2xx: "2", http_3xx: "0", http_4xx: "1", http_5xx: "1", average_response_time_ms: "8.5", p95_response_time_ms: "12" }] };
    return { rows: [{ healthy: 1 }] };
  } };
  const repository = createMonitoringRepository(() => db);
  const since = new Date("2026-09-04T03:00:00Z");
  const until = new Date("2026-09-04T04:00:00Z");
  assert.deepStrictEqual(await repository.getEventSummary({ since, until }), [{ eventType: "grades_query", total: 3, success: 2, failure: 1 }]);
  assert.deepStrictEqual(await repository.getHttpStatusSummary({ since, until }), { http2xx: 4, http3xx: 1, http4xx: 3, http5xx: 2 });
  assert.deepStrictEqual((await repository.getRequestTimeseries({ since, until, bucket: "5minute" }))[0], { timestamp: new Date("2026-09-04T03:55:00Z"), requestCount: 4, http2xx: 2, http3xx: 0, http4xx: 1, http5xx: 1, averageResponseTimeMs: 8.5, p95ResponseTimeMs: 12 });
  assert.deepStrictEqual((await repository.getErrorSummary({ since, until, limit: 20 }))[0], { eventType: "grades_query", errorType: "JWXT_TIMEOUT", count: 2, lastOccurredAt: new Date("2026-09-04T03:50:00Z") });
  await repository.checkPostgresHealth();
  assert.ok(calls.every(call => !/\bJOIN\b/i.test(call.sql)));
  assert.ok(calls.every(call => !/SELECT\s+\*/i.test(call.sql)));
  assert.ok(calls.every(call => !/\b(users|user_profiles|credentials|students)\b/i.test(call.sql)));
  assert.deepStrictEqual(calls[0].values, [since, until]);
  assert.deepStrictEqual(calls.find(call => /GROUP BY event_type, error_type/.test(call.sql)).values, [since, until, 20]);
  assert.match(calls.find(call => /GROUP BY bucket_at/.test(call.sql)).sql, /interval '5 minutes'/);
  assert.strictEqual(calls[0].values.length, 2);
  assert.ok(calls.every(call => call.queryTimeout > 0));
  assert.ok(calls.slice(0, 3).every(call => !/INSERT|UPDATE|DELETE/i.test(call.sql)));
  await assert.rejects(repository.getRequestTimeseries({ since, until, bucket: "minute; DROP TABLE monitor_events" }), /not allowed/);
  await assert.rejects(repository.getErrorSummary({ since, until, limit: 51 }), /limit is invalid/);
  console.log("adminMonitoringReadOnlyParameterizedQueriesTest=passed");
  console.log("adminMonitoringQueryWhitelistAndPrivacyTest=passed");
}

main().catch(err => { console.error(err); process.exitCode = 1; });
