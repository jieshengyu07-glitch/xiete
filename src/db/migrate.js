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
