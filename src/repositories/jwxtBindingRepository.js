const { getPool } = require("../db/pool");

const columns = `b.id, u.openid, b.student_id, b.password_enc, b.portal_auth_status,
  b.jwxt_status, b.xg_status, b.last_jwxt_login_at, b.last_successful_sync_at,
  b.last_failed_sync_at, b.last_jwxt_error, b.last_jwxt_error_message,
  b.last_xg_successful_at, b.created_at, b.updated_at`;

function toMeta(row) {
  if (!row) return null;
  return {
    studentId: String(row.student_id || ""), hasPassword: Boolean(row.password_enc),
    portalAuthStatus: row.portal_auth_status || "", jwxtStatus: row.jwxt_status || "",
    lastJwxtStatus: row.jwxt_status || "", lastJwxtLoginAt: row.last_jwxt_login_at || null,
    lastSuccessfulSyncAt: row.last_successful_sync_at || null, lastFailedSyncAt: row.last_failed_sync_at || null,
    lastJwxtError: row.last_jwxt_error || null, lastJwxtErrorMessage: row.last_jwxt_error_message || null,
    xgStatus: row.xg_status || "", lastXgSuccessfulAt: row.last_xg_successful_at || null,
    boundAt: row.created_at || null, updatedAt: row.updated_at || null, source: "postgres"
  };
}

async function findByOpenid(openid) {
  const db = getPool(); if (!db) return null;
  const result = await db.query(`SELECT ${columns} FROM jwxt_bindings b JOIN users u ON u.id=b.user_id WHERE u.openid=$1`, [String(openid || "")]);
  return result.rows[0] || null;
}

async function upsertBinding(openid, data) {
  const db = getPool(); if (!db) throw new Error("POSTGRES_NOT_ENABLED");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("INSERT INTO users (openid) VALUES ($1) ON CONFLICT (openid) DO UPDATE SET updated_at=NOW() RETURNING id", [String(openid || "")]);
    const u = user.rows[0].id;
    const d = data || {};
    const result = await client.query(`INSERT INTO jwxt_bindings
      (user_id, student_id, password_enc, portal_auth_status, jwxt_status, xg_status, last_jwxt_login_at, last_successful_sync_at, last_failed_sync_at, last_jwxt_error, last_jwxt_error_message, last_xg_successful_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (user_id) DO UPDATE SET student_id=EXCLUDED.student_id, password_enc=COALESCE(EXCLUDED.password_enc,jwxt_bindings.password_enc), portal_auth_status=EXCLUDED.portal_auth_status, jwxt_status=EXCLUDED.jwxt_status, xg_status=EXCLUDED.xg_status, last_jwxt_login_at=EXCLUDED.last_jwxt_login_at, last_successful_sync_at=EXCLUDED.last_successful_sync_at, last_failed_sync_at=EXCLUDED.last_failed_sync_at, last_jwxt_error=EXCLUDED.last_jwxt_error, last_jwxt_error_message=EXCLUDED.last_jwxt_error_message, last_xg_successful_at=EXCLUDED.last_xg_successful_at, updated_at=NOW()
      RETURNING *`, [u, String(d.studentId || ""), d.passwordEnc || null, d.portalAuthStatus || "", d.jwxtStatus || "", d.xgStatus || "", d.lastJwxtLoginAt || null, d.lastSuccessfulSyncAt || null, d.lastFailedSyncAt || null, d.lastJwxtError || null, d.lastJwxtErrorMessage || null, d.lastXgSuccessfulAt || null]);
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) { try { await client.query("ROLLBACK"); } catch (_) {} throw err; } finally { client.release(); }
}

async function updateBindingStatus(openid, patch) {
  const existing = await findByOpenid(openid); if (!existing) return null;
  const d = Object.assign({}, existing, patch || {});
  return upsertBinding(openid, {
    studentId: d.student_id || d.studentId, passwordEnc: d.password_enc || d.passwordEnc,
    portalAuthStatus: d.portal_auth_status || d.portalAuthStatus, jwxtStatus: d.jwxt_status || d.jwxtStatus,
    xgStatus: d.xg_status || d.xgStatus, lastJwxtLoginAt: d.last_jwxt_login_at || d.lastJwxtLoginAt,
    lastSuccessfulSyncAt: d.last_successful_sync_at || d.lastSuccessfulSyncAt, lastFailedSyncAt: d.last_failed_sync_at || d.lastFailedSyncAt,
    lastJwxtError: d.last_jwxt_error || d.lastJwxtError, lastJwxtErrorMessage: d.last_jwxt_error_message || d.lastJwxtErrorMessage,
    lastXgSuccessfulAt: d.last_xg_successful_at || d.lastXgSuccessfulAt
  });
}

async function deleteBinding(openid) {
  const db = getPool(); if (!db) return false;
  const result = await db.query("DELETE FROM jwxt_bindings b USING users u WHERE b.user_id=u.id AND u.openid=$1", [String(openid || "")]);
  return result.rowCount > 0;
}

module.exports = { findByOpenid, upsertBinding, updateBindingStatus, deleteBinding, toMeta };
