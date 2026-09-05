const assert = require("assert");
const { createMonitoringRepository } = require("../src/repositories/monitoringRepository");

async function main() {
  const calls = [];
  const db = {
    async query(query, legacyValues) {
      const sql = typeof query === "string" ? query : query.text;
      const values = typeof query === "string" ? legacyValues : query.values;
      calls.push({
        sql,
        values,
        queryTimeout: typeof query === "string" ? null : query.query_timeout
      });
      if (/FROM monitor_events/i.test(sql)) {
        return { rows: [{ unique_users_today: "4", active_users_last_5_minutes: "2" }] };
      }
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            request_count: "3",
            average_response_time_ms: "12.5",
            p95_response_time_ms: null
          }]
        };
      }
      return { rows: [] };
    }
  };
  const repository = createMonitoringRepository(() => db);
  const occurredAt = new Date("2026-09-04T00:00:00.000Z");
  await repository.insertRequestMetric({
    occurredAt,
    method: "get",
    route: "/test/:id",
    statusCode: 200,
    responseTimeMs: 12.4,
    userId: "ignored",
    headers: { authorization: "ignored" },
    body: { password: "ignored" }
  });
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.deepStrictEqual(calls[0].values, [occurredAt, "GET", "/test/:id", 200, 12]);
  assert.ok(!JSON.stringify(calls[0].values).includes("ignored"));
  await assert.rejects(repository.insertRequestMetric({
    method: "GET",
    route: "/raw?token=forbidden",
    statusCode: 200,
    responseTimeMs: 1
  }), /route template/);

  const summary = await repository.getRequestSummary({
    since: "2026-09-04T00:00:00.000Z",
    until: "2026-09-05T00:00:00.000Z"
  });
  assert.deepStrictEqual(summary, {
    requestCount: 3,
    averageResponseTimeMs: 12.5,
    p95ResponseTimeMs: null
  });
  assert.match(calls[1].sql, /percentile_cont\(0\.95\)/);
  assert.strictEqual(calls[1].queryTimeout, 5000);
  assert.deepStrictEqual(calls[1].values.map(value => value.toISOString()), [
    "2026-09-04T00:00:00.000Z",
    "2026-09-05T00:00:00.000Z"
  ]);

  const emptyRepository = createMonitoringRepository(() => ({
    query: async () => ({
      rows: [{ request_count: "0", average_response_time_ms: null, p95_response_time_ms: null }]
    })
  }));
  assert.deepStrictEqual(await emptyRepository.getRequestSummary({
    since: "2026-09-04T00:00:00.000Z",
    until: "2026-09-05T00:00:00.000Z"
  }), {
    requestCount: 0,
    averageResponseTimeMs: null,
    p95ResponseTimeMs: null
  });

  const userDayHash = "a".repeat(64);
  await repository.insertMonitorEvent({
    occurredAt,
    eventType: "grades_query",
    success: false,
    errorType: "JWXT_UNAVAILABLE",
    durationMs: 9.7,
    userDayHash,
    source: "jwxt",
    openid: "raw-user-must-not-be-stored",
    studentId: "student-must-not-be-stored",
    password: "password-must-not-be-stored",
    message: "message-must-not-be-stored",
    stack: "stack-must-not-be-stored",
    payload: { secret: "payload-must-not-be-stored" }
  });
  const eventCall = calls[2];
  assert.match(eventCall.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8\)/);
  assert.deepStrictEqual(eventCall.values, [
    occurredAt, "grades_query", false, "JWXT_UNAVAILABLE", 10, userDayHash, "jwxt", null
  ]);
  ["raw-user", "student-must", "password-must", "message-must", "stack-must", "payload-must"].forEach(value => {
    assert.ok(!JSON.stringify(eventCall.values).includes(value));
  });
  await assert.rejects(repository.insertMonitorEvent({
    eventType: "arbitrary_event",
    success: true,
    source: "unknown"
  }), /not allowed/);

  const daily = await repository.getDailyUserSummary({
    dayStart: "2026-09-03T16:00:00.000Z",
    dayEnd: "2026-09-04T16:00:00.000Z",
    activeSince: "2026-09-04T15:55:00.000Z"
  });
  assert.deepStrictEqual(daily, { uniqueUsersToday: 4, activeUsersLast5Minutes: 2 });
  const dailyCall = calls[3];
  assert.match(dailyCall.sql, /COUNT\(DISTINCT user_day_hash\)/);
  assert.match(dailyCall.sql, /user_day_hash IS NOT NULL/);
  assert.match(dailyCall.sql, /event_type <> 'bind_stage'/);
  assert.strictEqual(dailyCall.queryTimeout, 5000);
  console.log("monitoringRepositoryParameterizedInsertTest=passed");
  console.log("monitoringRepositorySummaryTest=passed");
  console.log("monitoringEventWhitelistAndPrivacyTest=passed");
  console.log("monitoringDailyUserSummaryTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
