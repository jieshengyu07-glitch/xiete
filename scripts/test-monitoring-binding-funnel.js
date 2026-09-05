const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createBusinessEventRecorder } = require("../src/services/businessEventRecorder");
const { createMonitoringRepository } = require("../src/repositories/monitoringRepository");
const { createAdminMetricsService } = require("../src/services/adminMetrics");

async function nextTurn() {
  await new Promise(resolve => setImmediate(resolve));
}

function serviceRepository(funnelRows, failureRows) {
  return {
    getRequestSummary: async () => ({ requestCount: 0, averageResponseTimeMs: null, p95ResponseTimeMs: null }),
    getDailyUserSummary: async () => ({ uniqueUsersToday: 0, activeUsersLast5Minutes: 0 }),
    getEventSummary: async () => [{ eventType: "bind_account", total: 25, success: 5, failure: 20 }],
    getLifetimeRequestSummary: async () => ({ requestCount: 0, averageResponseTimeMs: null, p95ResponseTimeMs: null, firstOccurredAt: null }),
    getLifetimeEventSummary: async () => ({ events: [], firstOccurredAt: null }),
    getRegisteredUserCount: async () => 100,
    getBoundUserCount: async () => 80,
    getBindingFunnel: async () => funnelRows,
    getBindingFailureBreakdown: async () => failureRows
  };
}

async function main() {
  const recorded = [];
  const recorder = createBusinessEventRecorder({
    repository: { insertMonitorEvent: event => { recorded.push(event); } },
    identity: { userDayHash: value => value ? "a".repeat(64) : null }
  });

  const complete = recorder.createBindStageTracker("private-user-id");
  ["bind_started", "portal_login_confirmed", "binding_saved", "jwxt_login_confirmed", "binding_saved"].forEach(complete);
  const beforePortalFailure = recorder.createBindStageTracker("private-user-id");
  beforePortalFailure("bind_started");
  const afterPortalPersistenceFailure = recorder.createBindStageTracker("private-user-id");
  afterPortalPersistenceFailure("bind_started");
  afterPortalPersistenceFailure("portal_login_confirmed");
  const jwxtFailure = recorder.createBindStageTracker("private-user-id");
  jwxtFailure("bind_started");
  jwxtFailure("portal_login_confirmed");
  jwxtFailure("binding_saved");
  await nextTurn();

  assert.deepStrictEqual(recorded.slice(0, 4).map(event => event.stage), [
    "bind_started", "portal_login_confirmed", "binding_saved", "jwxt_login_confirmed"
  ]);
  assert.strictEqual(recorded.filter(event => event.stage === "binding_saved").length, 2);
  assert.deepStrictEqual(recorded.slice(4, 5).map(event => event.stage), ["bind_started"]);
  assert.deepStrictEqual(recorded.slice(5, 7).map(event => event.stage), ["bind_started", "portal_login_confirmed"]);
  assert.deepStrictEqual(recorded.slice(7).map(event => event.stage), ["bind_started", "portal_login_confirmed", "binding_saved"]);
  assert.ok(recorded.every(event => event.eventType === "bind_stage" && event.success === true && event.errorType === null));
  assert.ok(recorded.slice(0, 4).every(event => event.occurredAt === recorded[0].occurredAt));
  assert.ok(recorded.every(event => event.userDayHash === "a".repeat(64)));
  assert.ok(!JSON.stringify(recorded).includes("private-user-id"));
  await assert.rejects(async () => complete("arbitrary_stage"), /stage is not allowed/);

  const calls = [];
  const db = { async query(query) {
    calls.push(query);
    if (/GROUP BY stage/.test(query.text)) return { rows: [
      { stage: "bind_started", stage_count: "25" },
      { stage: "portal_login_confirmed", stage_count: "18" },
      { stage: "binding_saved", stage_count: "8" },
      { stage: "jwxt_login_confirmed", stage_count: "5" }
    ] };
    if (/WITH classified AS/.test(query.text)) return { rows: [
      { reason_key: "invalid_credentials", failure_count: "12", affected_user_count: "7" },
      { reason_key: "school_login_failed", failure_count: "10", affected_user_count: "9" },
      { reason_key: "other", failure_count: "3", affected_user_count: "0" }
    ] };
    throw new Error("unexpected query");
  } };
  const repository = createMonitoringRepository(() => db);
  const since = new Date("2026-09-04T16:00:00.000Z");
  const until = new Date("2026-09-05T16:00:00.000Z");
  const funnelRows = await repository.getBindingFunnel({ since, until });
  const failureRows = await repository.getBindingFailureBreakdown({ since, until });
  assert.deepStrictEqual(funnelRows.map(row => row.count), [25, 18, 8, 5]);
  assert.deepStrictEqual(failureRows[0], { reasonKey: "invalid_credentials", failureCount: 12, affectedUsers: 7 });
  assert.deepStrictEqual(failureRows[2], { reasonKey: "other", failureCount: 3, affectedUsers: 0 });
  assert.ok(calls.every(call => call.query_timeout === 5000));
  assert.ok(calls.every(call => call.values[0] === since && call.values[1] === until));
  assert.match(calls[0].text, /event_type = 'bind_stage'/);
  assert.match(calls[0].text, /occurred_at >= \$1 AND occurred_at < \$2/);
  assert.match(calls[1].text, /event_type = 'bind_account'/);
  assert.match(calls[1].text, /COUNT\(DISTINCT user_day_hash\) FILTER \(WHERE user_day_hash IS NOT NULL\)/);
  assert.ok(calls.every(call => !/SELECT\s+\*|\bJOIN\b|\busers\b|jwxt_bindings|student_id|password|openid|error\.message|stack/i.test(call.text)));
  assert.ok(failureRows.every(row => !("userDayHash" in row) && !("errorType" in row)));

  const service = createAdminMetricsService({
    repository: serviceRepository(funnelRows, failureRows),
    now: () => new Date("2026-09-05T04:00:00.000Z")
  });
  const summary = await service.summary();
  assert.deepStrictEqual(summary.bindingFunnel, {
    started: 25,
    portalConfirmed: 18,
    saved: 8,
    jwxtConfirmed: 5,
    conversionRates: { portalFromStarted: 72, savedFromPortal: 44.4, jwxtFromSaved: 62.5, finalSuccess: 20 }
  });
  assert.deepStrictEqual(summary.bindingFailures[0], { reason: "账号或密码错误", failureCount: 12, affectedUsers: 7 });
  assert.strictEqual(summary.events.bindAccount.total, 25);
  assert.strictEqual(summary.events.bindAccount.success, 5);
  assert.strictEqual(summary.events.bindAccount.failure, 20);
  assert.ok(!/reasonKey|errorType|userDayHash|private-user-id/.test(JSON.stringify(summary)));

  const zero = await createAdminMetricsService({
    repository: serviceRepository([], []),
    now: () => new Date("2026-09-05T04:00:00.000Z")
  }).summary();
  assert.deepStrictEqual(zero.bindingFunnel.conversionRates, {
    portalFromStarted: 0, savedFromPortal: 0, jwxtFromSaved: 0, finalSuccess: 0
  });
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(zero)));

  const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const routeSource = serverSource.slice(serverSource.indexOf('// POST /bind-account'), serverSource.indexOf('// POST /unbind-account'));
  const stages = ["bind_started", "portal_login_confirmed", "binding_saved", "jwxt_login_confirmed"];
  stages.forEach(stage => assert.strictEqual((routeSource.match(new RegExp('recordBindStage\\("' + stage + '"\\)', "g")) || []).length, 1));
  assert.ok(routeSource.indexOf('recordBindStage("bind_started")') < routeSource.indexOf('recordBindStage("portal_login_confirmed")'));
  assert.ok(routeSource.indexOf('recordBindStage("portal_login_confirmed")') < routeSource.indexOf('recordBindStage("binding_saved")'));
  assert.ok(routeSource.indexOf('recordBindStage("binding_saved")') < routeSource.indexOf('recordBindStage("jwxt_login_confirmed")'));
  assert.match(routeSource, /if \(result && result\.success\) recordBindStage\("jwxt_login_confirmed"\)/);

  const repositorySource = fs.readFileSync(path.resolve(__dirname, "../src/repositories/monitoringRepository.js"), "utf8");
  assert.ok((repositorySource.match(/event_type <> 'bind_stage'/g) || []).length >= 3);

  console.log("bindingStagePerRequestDeduplicationTest=passed");
  console.log("bindingStageRealFlowOrderingTest=passed");
  console.log("bindingFunnelAggregationAndConversionTest=passed");
  console.log("bindingFailureBreakdownAffectedUsersTest=passed");
  console.log("bindingFunnelPrivacyAndBusinessRegressionTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
