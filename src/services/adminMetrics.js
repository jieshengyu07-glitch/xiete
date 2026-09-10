const monitoringRepository = require("../repositories/monitoringRepository");
const { shanghaiDateString } = require("./monitoringIdentity");
const { monitorEventLoopDelay } = require("perf_hooks");

const TIMEZONE = "Asia/Shanghai";
const EVENT_KEYS = {
  wechat_login: "wechatLogin",
  grades_query: "gradesQuery",
  timetable_query: "timetableQuery",
  bind_account: "bindAccount",
  unbind_account: "unbindAccount"
};
const EVENT_LABELS = {
  wechat_login: "微信登录",
  grades_query: "成绩查询",
  timetable_query: "课表查询",
  bind_account: "绑定账号",
  unbind_account: "解绑账号"
};
const CACHE_TTL_MS = { summary: 5000, health: 3000, timeseries: 10000, errors: 10000 };
const BIND_STAGE_KEYS = {
  bind_started: "started",
  portal_login_confirmed: "portalConfirmed",
  binding_saved: "saved",
  jwxt_login_confirmed: "jwxtConfirmed"
};
const BIND_FAILURE_LABELS = {
  invalid_credentials: "账号或密码错误",
  school_login_failed: "学校系统登录失败",
  captcha_required: "需要验证码",
  school_unavailable: "学校系统暂时无法访问",
  other: "其他"
};
const RANGE_MS = { "60m": 60 * 60 * 1000, "6h": 6 * 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000 };
const BUCKET_MS = { minute: 60 * 1000, "5minute": 5 * 60 * 1000, hour: 60 * 60 * 1000 };

const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelayMonitor.enable();

function defaultEventLoopDelayNanoseconds() {
  const value = Number(eventLoopDelayMonitor.mean);
  eventLoopDelayMonitor.reset();
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nanosecondsToMilliseconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number / 100000) / 10 : 0;
}

function runtimeSnapshot(options) {
  const config = options || {};
  try {
    const memory = config.memoryUsage();
    const safeBytes = value => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
    };
    const uptime = Number(config.uptime());
    return {
      rssBytes: safeBytes(memory.rss),
      heapUsedBytes: safeBytes(memory.heapUsed),
      heapTotalBytes: safeBytes(memory.heapTotal),
      externalBytes: safeBytes(memory.external),
      eventLoopLagMs: nanosecondsToMilliseconds(config.eventLoopDelayNanoseconds()),
      processUptimeSeconds: Number.isFinite(uptime) && uptime >= 0 ? Math.floor(uptime) : 0
    };
  } catch (_) {
    return {
      rssBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 0,
      externalBytes: 0,
      eventLoopLagMs: 0,
      processUptimeSeconds: 0
    };
  }
}

function createPromiseTtlCache(nowMs) {
  const entries = new Map();
  return async function cached(key, ttlMs, load) {
    const currentTime = Number(nowMs());
    const existing = entries.get(key);
    if (existing && existing.value !== undefined && existing.expiresAt > currentTime) return existing.value;
    if (existing && existing.promise) return existing.promise;
    const promise = Promise.resolve().then(load);
    entries.set(key, { promise, expiresAt: 0, value: undefined });
    try {
      const value = await promise;
      entries.set(key, { value, expiresAt: Number(nowMs()) + ttlMs, promise: null });
      return value;
    } catch (err) {
      entries.delete(key);
      throw err;
    }
  };
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function percentage(part, total) {
  const safePart = finiteOrZero(part);
  const safeTotal = finiteOrZero(total);
  return safeTotal > 0 ? Math.round(safePart / safeTotal * 1000) / 10 : 0;
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

function bindingFunnel(rows) {
  const counts = { started: 0, portalConfirmed: 0, saved: 0, jwxtConfirmed: 0 };
  rows.forEach(row => {
    const key = BIND_STAGE_KEYS[row.stage];
    if (key) counts[key] = finiteOrZero(row.count);
  });
  return Object.assign(counts, {
    conversionRates: {
      portalFromStarted: percentage(counts.portalConfirmed, counts.started),
      savedFromPortal: percentage(counts.saved, counts.portalConfirmed),
      jwxtFromSaved: percentage(counts.jwxtConfirmed, counts.saved),
      finalSuccess: percentage(counts.jwxtConfirmed, counts.started)
    }
  });
}

function bindingFailures(rows) {
  return rows.map(row => ({
    reason: BIND_FAILURE_LABELS[row.reasonKey] || BIND_FAILURE_LABELS.other,
    failureCount: finiteOrZero(row.failureCount),
    affectedUsers: finiteOrZero(row.affectedUsers)
  }));
}

function featureRanking(rows) {
  return rows
    .filter(row => Object.prototype.hasOwnProperty.call(EVENT_LABELS, row.eventType))
    .map(row => ({
      eventType: row.eventType,
      label: EVENT_LABELS[row.eventType],
      total: finiteOrZero(row.total),
      success: finiteOrZero(row.success),
      failure: finiteOrZero(row.failure)
    }))
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, "zh-CN"));
}

function createAdminMetricsService(options) {
  const config = options || {};
  const repository = config.repository || monitoringRepository;
  const now = config.now || (() => new Date());
  const uptime = config.uptime || process.uptime;
  const memoryUsage = config.memoryUsage || process.memoryUsage;
  const eventLoopDelayNanoseconds = config.eventLoopDelayNanoseconds || defaultEventLoopDelayNanoseconds;
  const clockMs = config.clockMs || Date.now;
  const healthTimeoutMs = Number(config.healthTimeoutMs || 3000);
  const cacheTtlMs = Object.assign({}, CACHE_TTL_MS, config.cacheTtlMs || {});
  const cached = createPromiseTtlCache(config.cacheNowMs || clockMs);
  const statusSummary = typeof repository.getHttpStatusSummary === "function"
    ? input => repository.getHttpStatusSummary(input)
    : async () => ({ http2xx: 0, http3xx: 0, http4xx: 0, http5xx: 0 });

  async function loadSummary() {
    const generatedAt = now();
    const bounds = shanghaiDayBounds(generatedAt);
    const activeSince = new Date(generatedAt.getTime() - 5 * 60 * 1000);
    const [requests, httpStatus, users, eventRows, lifetimeRequests, lifetimeEventSummary, registeredUsers, boundUsers, bindStageRows, bindFailureRows] = await Promise.all([
      repository.getRequestSummary({ since: bounds.start, until: bounds.end }),
      statusSummary({ since: bounds.start, until: bounds.end }),
      repository.getDailyUserSummary({ dayStart: bounds.start, dayEnd: bounds.end, activeSince }),
      repository.getEventSummary({ since: bounds.start, until: bounds.end }),
      repository.getLifetimeRequestSummary({ until: generatedAt }),
      repository.getLifetimeEventSummary({ until: generatedAt }),
      repository.getRegisteredUserCount(),
      repository.getBoundUserCount(),
      repository.getBindingFunnel({ since: bounds.start, until: bounds.end }),
      repository.getBindingFailureBreakdown({ since: bounds.start, until: bounds.end })
    ]);
    return {
      ok: true,
      generatedAt: generatedAt.toISOString(),
      timezone: TIMEZONE,
      today: {
        uniqueUsers: finiteOrZero(users.uniqueUsersToday),
        activeUsers5m: finiteOrZero(users.activeUsersLast5Minutes),
        requestCount: finiteOrZero(requests.requestCount),
        http4xxToday: finiteOrZero(httpStatus.http4xx),
        http5xxToday: finiteOrZero(httpStatus.http5xx),
        httpStatus: {
          http2xx: finiteOrZero(httpStatus.http2xx),
          http3xx: finiteOrZero(httpStatus.http3xx),
          http4xx: finiteOrZero(httpStatus.http4xx),
          http5xx: finiteOrZero(httpStatus.http5xx)
        },
        averageResponseTimeMs: finiteOrZero(requests.averageResponseTimeMs),
        p95ResponseTimeMs: finiteOrZero(requests.p95ResponseTimeMs)
      },
      events: eventSummary(eventRows, false),
      featureRanking: featureRanking(eventRows),
      bindingFunnel: bindingFunnel(bindStageRows),
      bindingFailures: bindingFailures(bindFailureRows),
      lifetime: {
        monitoringStartedAt: earliestDate(lifetimeRequests.firstOccurredAt, lifetimeEventSummary.firstOccurredAt),
        registeredUsers: finiteOrZero(registeredUsers),
        boundUsers: finiteOrZero(boundUsers),
        bindingRate: percentage(boundUsers, registeredUsers),
        requestCount: finiteOrZero(lifetimeRequests.requestCount),
        averageResponseTimeMs: finiteOrZero(lifetimeRequests.averageResponseTimeMs),
        p95ResponseTimeMs: finiteOrZero(lifetimeRequests.p95ResponseTimeMs),
        events: eventSummary(lifetimeEventSummary.events, true)
      }
    };
  }

  function summary() {
    return cached("summary", cacheTtlMs.summary, loadSummary);
  }

  async function loadTimeseries(input) {
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
        http2xx: row ? finiteOrZero(row.http2xx) : 0,
        http3xx: row ? finiteOrZero(row.http3xx) : 0,
        http4xx: row ? finiteOrZero(row.http4xx) : 0,
        http5xx: row ? finiteOrZero(row.http5xx) : 0,
        averageResponseTimeMs: row ? finiteOrZero(row.averageResponseTimeMs) : 0,
        p95ResponseTimeMs: row ? finiteOrZero(row.p95ResponseTimeMs) : 0
      });
    }
    return { ok: true, range, bucket, points };
  }

  function timeseries(input) {
    const range = String(input && input.range || "60m");
    const bucket = String(input && input.bucket || "minute");
    return cached("timeseries:" + range + ":" + bucket, cacheTtlMs.timeseries, () => loadTimeseries(input));
  }

  async function loadErrors(input) {
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

  function errors(input) {
    const limit = String(input && input.limit === undefined ? 20 : input && input.limit);
    return cached("errors:" + limit, cacheTtlMs.errors, () => loadErrors(input));
  }

  async function loadHealth() {
    const startedAt = clockMs();
    const runtime = runtimeSnapshot({ memoryUsage, uptime, eventLoopDelayNanoseconds });
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
        service: { status: "ok", uptimeSeconds: runtime.processUptimeSeconds },
        runtime,
        postgres: { status: "ok", latencyMs: Math.max(0, clockMs() - startedAt) }
      };
    } catch (_) {
      return {
        ok: false,
        service: { status: "ok", uptimeSeconds: runtime.processUptimeSeconds },
        runtime,
        postgres: { status: "error", latencyMs: Math.max(0, clockMs() - startedAt) }
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function health() {
    return cached("health", cacheTtlMs.health, loadHealth);
  }

  return { summary, timeseries, errors, health };
}

module.exports = {
  createAdminMetricsService,
  createPromiseTtlCache,
  nanosecondsToMilliseconds,
  runtimeSnapshot,
  featureRanking,
  shanghaiDayBounds,
  RANGE_MS,
  BUCKET_MS,
  CACHE_TTL_MS
};
