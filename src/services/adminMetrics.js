const monitoringRepository = require("../repositories/monitoringRepository");
const { shanghaiDateString } = require("./monitoringIdentity");

const TIMEZONE = "Asia/Shanghai";
const EVENT_KEYS = {
  wechat_login: "wechatLogin",
  grades_query: "gradesQuery",
  timetable_query: "timetableQuery",
  bind_account: "bindAccount",
  unbind_account: "unbindAccount"
};
const RANGE_MS = { "60m": 60 * 60 * 1000, "6h": 6 * 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000 };
const BUCKET_MS = { minute: 60 * 1000, "5minute": 5 * 60 * 1000, hour: 60 * 60 * 1000 };

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function shanghaiDayBounds(value) {
  const day = shanghaiDateString(value);
  const start = new Date(day + "T00:00:00+08:00");
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function floorDate(value, intervalMs) {
  return new Date(Math.floor(value.getTime() / intervalMs) * intervalMs);
}

function eventSummary(rows, includeSuccessRate) {
  const events = {};
  Object.values(EVENT_KEYS).forEach(key => {
    events[key] = { total: 0, success: 0, failure: 0 };
    if (includeSuccessRate) events[key].successRate = 0;
  });
  rows.forEach(row => {
    const key = EVENT_KEYS[row.eventType];
    if (!key) return;
    const total = finiteOrZero(row.total);
    const success = finiteOrZero(row.success);
    events[key] = {
      total,
      success,
      failure: finiteOrZero(row.failure)
    };
    if (includeSuccessRate) events[key].successRate = total ? Math.round(success / total * 1000) / 10 : 0;
  });
  return events;
}

function earliestDate(left, right) {
  const dates = [left, right].filter(Boolean).map(value => new Date(value)).filter(value => !Number.isNaN(value.getTime()));
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map(value => value.getTime()))).toISOString();
}

function createAdminMetricsService(options) {
  const config = options || {};
  const repository = config.repository || monitoringRepository;
  const now = config.now || (() => new Date());
  const uptime = config.uptime || process.uptime;
  const healthTimeoutMs = Number(config.healthTimeoutMs || 3000);

  async function summary() {
    const generatedAt = now();
    const bounds = shanghaiDayBounds(generatedAt);
    const activeSince = new Date(generatedAt.getTime() - 5 * 60 * 1000);
    const [requests, users, eventRows, lifetimeRequests, lifetimeEventSummary, registeredUsers] = await Promise.all([
      repository.getRequestSummary({ since: bounds.start, until: bounds.end }),
      repository.getDailyUserSummary({ dayStart: bounds.start, dayEnd: bounds.end, activeSince }),
      repository.getEventSummary({ since: bounds.start, until: bounds.end }),
      repository.getLifetimeRequestSummary({ until: generatedAt }),
      repository.getLifetimeEventSummary({ until: generatedAt }),
      repository.getRegisteredUserCount()
    ]);
    return {
      ok: true,
      generatedAt: generatedAt.toISOString(),
      timezone: TIMEZONE,
      today: {
        uniqueUsers: finiteOrZero(users.uniqueUsersToday),
        activeUsers5m: finiteOrZero(users.activeUsersLast5Minutes),
        requestCount: finiteOrZero(requests.requestCount),
        averageResponseTimeMs: finiteOrZero(requests.averageResponseTimeMs),
        p95ResponseTimeMs: finiteOrZero(requests.p95ResponseTimeMs)
      },
      events: eventSummary(eventRows, false),
      lifetime: {
        monitoringStartedAt: earliestDate(lifetimeRequests.firstOccurredAt, lifetimeEventSummary.firstOccurredAt),
        registeredUsers: finiteOrZero(registeredUsers),
        requestCount: finiteOrZero(lifetimeRequests.requestCount),
        averageResponseTimeMs: finiteOrZero(lifetimeRequests.averageResponseTimeMs),
        p95ResponseTimeMs: finiteOrZero(lifetimeRequests.p95ResponseTimeMs),
        events: eventSummary(lifetimeEventSummary.events, true)
      }
    };
  }

  async function timeseries(input) {
    const range = String(input && input.range || "60m");
    const bucket = String(input && input.bucket || "minute");
    if (!RANGE_MS[range] || !BUCKET_MS[bucket]) throw Object.assign(new Error("invalid window"), { code: "INVALID_TIMESERIES_WINDOW" });
    const pointCount = Math.ceil(RANGE_MS[range] / BUCKET_MS[bucket]);
    if (pointCount > 300) throw Object.assign(new Error("too many points"), { code: "INVALID_TIMESERIES_WINDOW" });
    const until = now();
    const since = new Date(until.getTime() - RANGE_MS[range]);
    const firstBucket = floorDate(since, BUCKET_MS[bucket]);
    const rows = await repository.getRequestTimeseries({ since, until, bucket });
    const byTimestamp = new Map(rows.map(row => [floorDate(row.timestamp, BUCKET_MS[bucket]).toISOString(), row]));
    const points = [];
    for (let cursor = firstBucket.getTime(); cursor < until.getTime() && points.length < 300; cursor += BUCKET_MS[bucket]) {
      const timestamp = new Date(cursor).toISOString();
      const row = byTimestamp.get(timestamp);
      points.push({
        timestamp,
        requestCount: row ? finiteOrZero(row.requestCount) : 0,
        averageResponseTimeMs: row ? finiteOrZero(row.averageResponseTimeMs) : 0,
        p95ResponseTimeMs: row ? finiteOrZero(row.p95ResponseTimeMs) : 0
      });
    }
    return { ok: true, range, bucket, points };
  }

  async function errors(input) {
    const rawLimit = input && input.limit === undefined ? 20 : Number(input.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      throw Object.assign(new Error("invalid limit"), { code: "INVALID_LIMIT" });
    }
    const until = now();
    const since = new Date(until.getTime() - RANGE_MS["24h"]);
    const rows = await repository.getErrorSummary({ since, until, limit: rawLimit });
    return {
      ok: true,
      errors: rows.map(row => ({
        eventType: row.eventType,
        errorType: row.errorType,
        count: finiteOrZero(row.count),
        lastOccurredAt: new Date(row.lastOccurredAt).toISOString()
      }))
    };
  }

  async function health() {
    const startedAt = Date.now();
    let timer;
    try {
      await Promise.race([
        repository.checkPostgresHealth({ timeoutMs: healthTimeoutMs }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "HEALTH_TIMEOUT" })), healthTimeoutMs);
        })
      ]);
      return {
        ok: true,
        service: { status: "ok", uptimeSeconds: Math.max(0, Math.floor(uptime())) },
        postgres: { status: "ok", latencyMs: Math.max(0, Date.now() - startedAt) }
      };
    } catch (_) {
      return {
        ok: false,
        service: { status: "ok", uptimeSeconds: Math.max(0, Math.floor(uptime())) },
        postgres: { status: "error", latencyMs: Math.max(0, Date.now() - startedAt) }
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { summary, timeseries, errors, health };
}

module.exports = { createAdminMetricsService, shanghaiDayBounds, RANGE_MS, BUCKET_MS };
