const assert = require("assert");
const {
  createPromiseTtlCache,
  nanosecondsToMilliseconds,
  runtimeSnapshot,
  featureRanking
} = require("../src/services/adminMetrics");
const {
  requestFeatureCategory,
  CLIENT_CLOSED_REQUEST_STATUS
} = require("../src/middleware/requestMetrics");

async function main() {
  let now = 1000;
  let loads = 0;
  const cached = createPromiseTtlCache(() => now);
  const load = async () => ({ sequence: ++loads });
  const concurrent = await Promise.all([
    cached("summary", 5000, load),
    cached("summary", 5000, load)
  ]);
  assert.strictEqual(loads, 1);
  assert.deepStrictEqual(concurrent[0], concurrent[1]);
  now = 5999;
  assert.strictEqual((await cached("summary", 5000, load)).sequence, 1);
  now = 6001;
  assert.strictEqual((await cached("summary", 5000, load)).sequence, 2);
  assert.strictEqual(loads, 2);

  let summaryClock = 0;
  let requestSummaryLoads = 0;
  const summaryRepository = {
    async getRequestSummary() { requestSummaryLoads += 1; return { requestCount: 1, averageResponseTimeMs: 2, p95ResponseTimeMs: 3 }; },
    async getHttpStatusSummary() { return { http2xx: 1, http3xx: 0, http4xx: 0, http5xx: 0 }; },
    async getDailyUserSummary() { return { uniqueUsersToday: 1, activeUsersLast5Minutes: 1 }; },
    async getEventSummary() { return []; },
    async getLifetimeRequestSummary() { return { requestCount: 1, averageResponseTimeMs: 2, p95ResponseTimeMs: 3, firstOccurredAt: null }; },
    async getLifetimeEventSummary() { return { events: [], firstOccurredAt: null }; },
    async getRegisteredUserCount() { return 1; },
    async getBoundUserCount() { return 0; },
    async getBindingFunnel() { return []; },
    async getBindingFailureBreakdown() { return []; }
  };
  const { createAdminMetricsService } = require("../src/services/adminMetrics");
  const summaryService = createAdminMetricsService({
    repository: summaryRepository,
    now: () => new Date("2026-09-09T04:00:00Z"),
    cacheNowMs: () => summaryClock
  });
  await Promise.all([summaryService.summary(), summaryService.summary()]);
  assert.strictEqual(requestSummaryLoads, 1);
  summaryClock = 4999;
  await summaryService.summary();
  assert.strictEqual(requestSummaryLoads, 1);
  summaryClock = 5001;
  await summaryService.summary();
  assert.strictEqual(requestSummaryLoads, 2);

  assert.strictEqual(nanosecondsToMilliseconds(12500000), 12.5);
  assert.deepStrictEqual(runtimeSnapshot({
    memoryUsage: () => ({ rss: 1024, heapUsed: 512, heapTotal: 2048, external: 64 }),
    uptime: () => 42.9,
    eventLoopDelayNanoseconds: () => 7500000
  }), {
    rssBytes: 1024,
    heapUsedBytes: 512,
    heapTotalBytes: 2048,
    externalBytes: 64,
    eventLoopLagMs: 7.5,
    processUptimeSeconds: 42
  });

  const ranking = featureRanking([
    { eventType: "bind_stage", total: 999, success: 999, failure: 0 },
    { eventType: "grades_query", total: 7, success: 6, failure: 1 },
    { eventType: "wechat_login", total: 3, success: 3, failure: 0 },
    { eventType: "timetable_query", total: 12, success: 10, failure: 2 }
  ]);
  assert.deepStrictEqual(ranking.map(item => item.eventType), ["timetable_query", "grades_query", "wechat_login"]);
  assert.ok(!ranking.some(item => item.eventType === "bind_stage"));

  assert.strictEqual(requestFeatureCategory("POST", "/auth/wechat-login"), "auth");
  assert.strictEqual(requestFeatureCategory("GET", "/grades"), "grades");
  assert.strictEqual(requestFeatureCategory("GET", "/timetable/today"), "timetable");
  assert.strictEqual(requestFeatureCategory("POST", "/preferences/campus"), "preferences");
  assert.strictEqual(requestFeatureCategory("GET", "/status"), "status");
  assert.strictEqual(requestFeatureCategory("POST", "/bind-account"), "account");
  assert.strictEqual(requestFeatureCategory("GET", "/api/courses/:id/reviews"), "reviews");
  assert.strictEqual(requestFeatureCategory("GET", "/unknown"), "other");
  assert.strictEqual(CLIENT_CLOSED_REQUEST_STATUS, 499);

  console.log("monitoringV1PromiseTtlAndConcurrentMissTest=passed");
  console.log("monitoringV1SummaryTtlExpiryTest=passed");
  console.log("monitoringV1RuntimeUnitsAndFiniteFieldsTest=passed");
  console.log("monitoringV1FeatureRankingWhitelistTest=passed");
  console.log("monitoringV1RequestFeatureTaxonomyAnd499ConventionTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
