const { getPool } = require("../db/pool");

const MONITOR_EVENT_TYPES = new Set([
  "wechat_login",
  "bind_account",
  "unbind_account",
  "grades_query",
  "timetable_query",
  "bind_stage"
]);
const BIND_STAGES = new Set([
  "bind_started",
  "portal_login_confirmed",
  "binding_saved",
  "jwxt_login_confirmed"
]);
const MONITOR_EVENT_SOURCES = new Set([
  "cache",
  "jwxt",
  "postgres",
  "local",
  "wechat",
  "unknown"
]);
const MONITOR_ERROR_TYPES = new Set([
  "ACCOUNT_RELOGIN_REQUIRED",
  "CAMPUS_LOGIN_REQUIRED",
  "COOKIE_EXPIRED",
  "DATA_DELETION_IN_PROGRESS",
  "GRADE_QUERY_UNAVAILABLE",
  "INTERNAL_ERROR",
  "INVALID_ACCOUNT",
  "INVALID_CREDENTIALS",
  "INVALID_DATE",
  "JWXT_CAPTCHA_INVALID",
  "JWXT_CAPTCHA_REQUIRED",
  "JWXT_CAPTCHA_SESSION_EXPIRED",
  "JWXT_INVALID_CREDENTIALS",
  "JWXT_LOGIN_FAILED",
  "JWXT_SSO_FAILED",
  "JWXT_TIMEOUT",
  "JWXT_UNAVAILABLE",
  "LOGIN_REQUIRED",
  "NOT_BOUND",
  "PERSISTENCE_UNAVAILABLE",
  "PORTAL_LOGIN_UNCONFIRMED",
  "PORTAL_UNAVAILABLE",
  "PORTAL_VERIFICATION_REQUIRED",
  "RATE_LIMITED",
  "REVIEW_DEMO_ACCOUNT_CONFLICT",
  "REVIEW_DEMO_UNAVAILABLE",
  "TIMETABLE_CONFIG_FAILED",
  "TIMETABLE_EMPTY",
  "TIMETABLE_TODAY_FAILED",
  "TIMETABLE_WEEK_FAILED",
  "UNAUTHORIZED",
  "UNBIND_FAILED",
  "UNKNOWN",
  "WECHAT_CONFIG_MISSING",
  "WECHAT_LOGIN_FAILED",
  "XG_LOGIN_REQUIRED",
  "XG_SESSION_MISSING"
]);

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new TypeError(name + " must be a valid date");
  return date;
}

function requestMetric(value) {
  const metric = value && typeof value === "object" ? value : {};
  const occurredAt = metric.occurredAt === undefined
    ? new Date()
    : requiredDate(metric.occurredAt, "occurredAt");
  const method = String(metric.method || "").trim().toUpperCase();
  const route = String(metric.route || "").trim();
  const statusCode = Number(metric.statusCode);
  const responseTimeMs = Number(metric.responseTimeMs);

  if (!method || method.length > 16) throw new TypeError("method is invalid");
  if (!route || route.length > 512 || route.includes("?") || route.includes("#")) {
    throw new TypeError("route must be a route template");
  }
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new TypeError("statusCode is invalid");
  }
  if (!Number.isFinite(responseTimeMs) || responseTimeMs < 0) {
    throw new TypeError("responseTimeMs is invalid");
  }

  return {
    occurredAt,
    method,
    route,
    statusCode,
    responseTimeMs: Math.round(responseTimeMs)
  };
}

function normalizeMonitorErrorType(value) {
  const code = String(value || "").trim().toUpperCase();
  return MONITOR_ERROR_TYPES.has(code) ? code : "UNKNOWN";
}

function normalizeMonitorSource(value) {
  const source = String(value || "unknown").trim().toLowerCase();
  return MONITOR_EVENT_SOURCES.has(source) ? source : "unknown";
}

function normalizeMonitorStage(value) {
  const stage = String(value || "").trim().toLowerCase();
  if (!BIND_STAGES.has(stage)) throw new TypeError("stage is not allowed");
  return stage;
}

function monitorEvent(value) {
  const event = value && typeof value === "object" ? value : {};
  const occurredAt = event.occurredAt === undefined
    ? new Date()
    : requiredDate(event.occurredAt, "occurredAt");
  const eventType = String(event.eventType || "").trim();
  if (!MONITOR_EVENT_TYPES.has(eventType)) throw new TypeError("eventType is not allowed");
  if (typeof event.success !== "boolean") throw new TypeError("success must be boolean");
  if (eventType === "bind_stage" && event.success !== true) throw new TypeError("bind stage must be successful");
  if (eventType !== "bind_stage" && event.stage !== null && event.stage !== undefined) throw new TypeError("stage is only allowed for bind stage events");

  let durationMs = null;
  if (event.durationMs !== null && event.durationMs !== undefined) {
    durationMs = Number(event.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError("durationMs is invalid");
    durationMs = Math.round(durationMs);
  }

  const userDayHash = event.userDayHash === null || event.userDayHash === undefined
    ? null
    : String(event.userDayHash).trim().toLowerCase();
  if (userDayHash !== null && !/^[a-f0-9]{64}$/.test(userDayHash)) {
    throw new TypeError("userDayHash is invalid");
  }

  return {
    occurredAt,
    eventType,
    success: event.success,
    errorType: event.success ? null : normalizeMonitorErrorType(event.errorType),
    durationMs,
    userDayHash,
    source: normalizeMonitorSource(event.source),
    stage: eventType === "bind_stage" ? normalizeMonitorStage(event.stage) : null
  };
}

function createMonitoringRepository(poolProvider) {
  const providePool = poolProvider || getPool;
  const adminQuery = (db, text, values, timeoutMs) => db.query({
    text,
    values,
    query_timeout: Number(timeoutMs || 5000)
  });

  async function insertRequestMetric(value) {
    const metric = requestMetric(value);
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    await db.query(
      `INSERT INTO api_request_metrics
        (occurred_at, method, route, status_code, response_time_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [metric.occurredAt, metric.method, metric.route, metric.statusCode, metric.responseTimeMs]
    );
  }

  async function getRequestSummary(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    if (until.getTime() < since.getTime()) throw new TypeError("until must not precede since");

    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT COUNT(*) AS request_count,
              AVG(response_time_ms) AS average_response_time_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_response_time_ms
         FROM api_request_metrics
        WHERE occurred_at >= $1 AND occurred_at < $2`,
      [since, until]
    );
    const row = result.rows[0] || {};
    return {
      requestCount: Number(row.request_count || 0),
      averageResponseTimeMs: finiteNumber(row.average_response_time_ms),
      p95ResponseTimeMs: finiteNumber(row.p95_response_time_ms)
    };
  }

  async function insertMonitorEvent(value) {
    const event = monitorEvent(value);
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    await db.query(
      `INSERT INTO monitor_events
        (occurred_at, event_type, success, error_type, duration_ms, user_day_hash, source, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.occurredAt,
        event.eventType,
        event.success,
        event.errorType,
        event.durationMs,
        event.userDayHash,
        event.source,
        event.stage
      ]
    );
  }

  async function getBindingFunnel(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    if (until.getTime() <= since.getTime()) throw new TypeError("until must follow since");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT stage, COUNT(*) AS stage_count
         FROM monitor_events
        WHERE event_type = 'bind_stage'
          AND stage IS NOT NULL
          AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY stage`,
      [since, until]
    );
    return result.rows.map(row => ({
      stage: normalizeMonitorStage(row.stage),
      count: Number(row.stage_count || 0)
    }));
  }

  async function getBindingFailureBreakdown(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    if (until.getTime() <= since.getTime()) throw new TypeError("until must follow since");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `WITH classified AS (
         SELECT CASE
                  WHEN error_type IN ('INVALID_ACCOUNT', 'INVALID_CREDENTIALS', 'JWXT_INVALID_CREDENTIALS') THEN 'invalid_credentials'
                  WHEN error_type IN ('PORTAL_LOGIN_UNCONFIRMED', 'PORTAL_VERIFICATION_REQUIRED', 'JWXT_LOGIN_FAILED', 'JWXT_SSO_FAILED') THEN 'school_login_failed'
                  WHEN error_type IN ('JWXT_CAPTCHA_REQUIRED', 'JWXT_CAPTCHA_INVALID', 'JWXT_CAPTCHA_SESSION_EXPIRED') THEN 'captcha_required'
                  WHEN error_type IN ('JWXT_UNAVAILABLE', 'JWXT_TIMEOUT', 'PORTAL_UNAVAILABLE') THEN 'school_unavailable'
                  ELSE 'other'
                END AS reason_key,
                user_day_hash
           FROM monitor_events
          WHERE event_type = 'bind_account'
            AND success = FALSE
            AND occurred_at >= $1 AND occurred_at < $2
       )
       SELECT reason_key,
              COUNT(*) AS failure_count,
              COUNT(DISTINCT user_day_hash) FILTER (WHERE user_day_hash IS NOT NULL) AS affected_user_count
         FROM classified
        GROUP BY reason_key
        ORDER BY COUNT(*) DESC, reason_key ASC`,
      [since, until]
    );
    return result.rows.map(row => ({
      reasonKey: String(row.reason_key),
      failureCount: Number(row.failure_count || 0),
      affectedUsers: Number(row.affected_user_count || 0)
    }));
  }

  async function getDailyUserSummary(options) {
    const input = options || {};
    const dayStart = requiredDate(input.dayStart, "dayStart");
    const dayEnd = requiredDate(input.dayEnd, "dayEnd");
    const activeSince = requiredDate(input.activeSince, "activeSince");
    if (dayEnd.getTime() <= dayStart.getTime()) throw new TypeError("dayEnd must follow dayStart");
    if (activeSince.getTime() >= dayEnd.getTime()) throw new TypeError("activeSince must precede dayEnd");

    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT COUNT(DISTINCT user_day_hash) FILTER (
                WHERE occurred_at >= $1 AND occurred_at < $2
              ) AS unique_users_today,
              COUNT(DISTINCT user_day_hash) FILTER (
                WHERE occurred_at >= $3 AND occurred_at < $2
              ) AS active_users_last_5_minutes
         FROM monitor_events
        WHERE user_day_hash IS NOT NULL
          AND event_type <> 'bind_stage'
          AND occurred_at >= LEAST($1, $3)
          AND occurred_at < $2`,
      [dayStart, dayEnd, activeSince]
    );
    const row = result.rows[0] || {};
    return {
      uniqueUsersToday: Number(row.unique_users_today || 0),
      activeUsersLast5Minutes: Number(row.active_users_last_5_minutes || 0)
    };
  }

  async function getEventSummary(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    if (until.getTime() <= since.getTime()) throw new TypeError("until must follow since");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT event_type,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE success = TRUE) AS success_count,
              COUNT(*) FILTER (WHERE success = FALSE) AS failure_count
         FROM monitor_events
        WHERE occurred_at >= $1 AND occurred_at < $2
          AND event_type <> 'bind_stage'
        GROUP BY event_type`,
      [since, until]
    );
    return result.rows.map(row => ({
      eventType: String(row.event_type),
      total: Number(row.total || 0),
      success: Number(row.success_count || 0),
      failure: Number(row.failure_count || 0)
    }));
  }

  async function getLifetimeRequestSummary(options) {
    const until = requiredDate(options && options.until, "until");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT COUNT(*) AS request_count,
              AVG(response_time_ms) AS average_response_time_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_response_time_ms,
              MIN(occurred_at) AS first_occurred_at
         FROM api_request_metrics
        WHERE occurred_at <= $1`,
      [until]
    );
    const row = result.rows[0] || {};
    return {
      requestCount: Number(row.request_count || 0),
      averageResponseTimeMs: finiteNumber(row.average_response_time_ms),
      p95ResponseTimeMs: finiteNumber(row.p95_response_time_ms),
      firstOccurredAt: row.first_occurred_at ? requiredDate(row.first_occurred_at, "first_occurred_at") : null
    };
  }

  async function getLifetimeEventSummary(options) {
    const until = requiredDate(options && options.until, "until");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT event_type,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE success = TRUE) AS success_count,
              COUNT(*) FILTER (WHERE success = FALSE) AS failure_count,
              MIN(occurred_at) AS first_occurred_at
         FROM monitor_events
        WHERE occurred_at <= $1
          AND event_type <> 'bind_stage'
        GROUP BY event_type`,
      [until]
    );
    let firstOccurredAt = null;
    const events = result.rows.map(row => {
      const rowFirst = row.first_occurred_at ? requiredDate(row.first_occurred_at, "first_occurred_at") : null;
      if (rowFirst && (!firstOccurredAt || rowFirst.getTime() < firstOccurredAt.getTime())) firstOccurredAt = rowFirst;
      return {
        eventType: String(row.event_type),
        total: Number(row.total || 0),
        success: Number(row.success_count || 0),
        failure: Number(row.failure_count || 0)
      };
    });
    return { events, firstOccurredAt };
  }

  async function getRegisteredUserCount() {
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db, "SELECT COUNT(*) AS registered_user_count FROM users", []);
    return Number(result.rows[0] && result.rows[0].registered_user_count || 0);
  }

  async function getBoundUserCount() {
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db, "SELECT COUNT(*) AS bound_user_count FROM jwxt_bindings", []);
    return Number(result.rows[0] && result.rows[0].bound_user_count || 0);
  }

  async function getRequestTimeseries(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    const bucketExpressions = {
      minute: "date_trunc('minute', occurred_at)",
      "5minute": "date_trunc('hour', occurred_at) + floor(date_part('minute', occurred_at) / 5) * interval '5 minutes'",
      hour: "date_trunc('hour', occurred_at)"
    };
    const expression = bucketExpressions[input.bucket];
    if (!expression) throw new TypeError("bucket is not allowed");
    if (until.getTime() <= since.getTime()) throw new TypeError("until must follow since");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT ${expression} AS bucket_at,
              COUNT(*) AS request_count,
              AVG(response_time_ms) AS average_response_time_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_response_time_ms
         FROM api_request_metrics
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY bucket_at
        ORDER BY bucket_at ASC`,
      [since, until]
    );
    return result.rows.map(row => ({
      timestamp: requiredDate(row.bucket_at, "bucket_at"),
      requestCount: Number(row.request_count || 0),
      averageResponseTimeMs: finiteNumber(row.average_response_time_ms),
      p95ResponseTimeMs: finiteNumber(row.p95_response_time_ms)
    }));
  }

  async function getErrorSummary(options) {
    const input = options || {};
    const since = requiredDate(input.since, "since");
    const until = requiredDate(input.until, "until");
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError("limit is invalid");
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const result = await adminQuery(db,
      `SELECT event_type, error_type, COUNT(*) AS error_count, MAX(occurred_at) AS last_occurred_at
         FROM monitor_events
        WHERE success = FALSE
          AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY event_type, error_type
        ORDER BY MAX(occurred_at) DESC, COUNT(*) DESC
        LIMIT $3`,
      [since, until, limit]
    );
    return result.rows.map(row => ({
      eventType: String(row.event_type),
      errorType: String(row.error_type || "UNKNOWN"),
      count: Number(row.error_count || 0),
      lastOccurredAt: requiredDate(row.last_occurred_at, "last_occurred_at")
    }));
  }

  async function checkPostgresHealth(options) {
    const db = providePool();
    if (!db) throw new Error("POSTGRES_NOT_ENABLED");
    const timeoutMs = Number(options && options.timeoutMs || 3000);
    await adminQuery(db, "SELECT 1 AS healthy", [], timeoutMs);
  }

  return {
    insertRequestMetric,
    getRequestSummary,
    insertMonitorEvent,
    getBindingFunnel,
    getBindingFailureBreakdown,
    getDailyUserSummary,
    getEventSummary,
    getLifetimeRequestSummary,
    getLifetimeEventSummary,
    getRegisteredUserCount,
    getBoundUserCount,
    getRequestTimeseries,
    getErrorSummary,
    checkPostgresHealth
  };
}

const repository = createMonitoringRepository();

module.exports = Object.assign(repository, {
  createMonitoringRepository,
  normalizeMonitorErrorType,
  normalizeMonitorSource,
  normalizeMonitorStage
});
