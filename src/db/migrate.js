const { getPool } = require("./pool");

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    openid TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS jwxt_bindings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    password_enc TEXT,
    portal_auth_status TEXT NOT NULL DEFAULT '',
    jwxt_status TEXT NOT NULL DEFAULT '',
    xg_status TEXT NOT NULL DEFAULT '',
    last_jwxt_login_at TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    last_failed_sync_at TIMESTAMPTZ,
    last_jwxt_error TEXT,
    last_jwxt_error_message TEXT,
    last_xg_successful_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS jwxt_bindings_student_id_idx ON jwxt_bindings(student_id)"
  ,`CREATE TABLE IF NOT EXISTS campus_cache (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    grades_payload JSONB,
    grades_updated_at TIMESTAMPTZ,
    timetable_payload JSONB,
    timetable_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  ,`CREATE TABLE IF NOT EXISTS sync_state (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    grades_last_attempt_at TIMESTAMPTZ,
    grades_last_success_at TIMESTAMPTZ,
    grades_last_error TEXT,
    grades_next_retry_at TIMESTAMPTZ,
    timetable_last_attempt_at TIMESTAMPTZ,
    timetable_last_success_at TIMESTAMPTZ,
    timetable_last_error TEXT,
    timetable_next_retry_at TIMESTAMPTZ,
    campus_last_attempt_at TIMESTAMPTZ,
    campus_last_success_at TIMESTAMPTZ,
    campus_last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  ,`CREATE TABLE IF NOT EXISTS api_request_metrics (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    status_code SMALLINT NOT NULL,
    response_time_ms INTEGER NOT NULL
  )`
  ,"CREATE INDEX IF NOT EXISTS api_request_metrics_occurred_at_idx ON api_request_metrics (occurred_at)"
  ,"CREATE INDEX IF NOT EXISTS api_request_metrics_route_occurred_at_idx ON api_request_metrics (route, occurred_at)"
  ,`CREATE TABLE IF NOT EXISTS monitor_events (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error_type TEXT,
    duration_ms INTEGER,
    user_day_hash TEXT,
    source TEXT
  )`
  ,"CREATE INDEX IF NOT EXISTS monitor_events_occurred_at_idx ON monitor_events (occurred_at)"
  ,"CREATE INDEX IF NOT EXISTS monitor_events_event_type_occurred_at_idx ON monitor_events (event_type, occurred_at)"
  ,"CREATE INDEX IF NOT EXISTS monitor_events_user_day_hash_occurred_at_idx ON monitor_events (user_day_hash, occurred_at)"
];

async function migrate() {
  const db = getPool();
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const sql of statements) await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally { client.release(); }
}

module.exports = { migrate };
