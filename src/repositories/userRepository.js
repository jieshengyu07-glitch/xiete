const { getPool } = require("../db/pool");

function cleanOpenid(openid) { return String(openid || "").trim(); }

async function findByOpenid(openid) {
  const db = getPool(); if (!db) return null;
  const result = await db.query("SELECT id, openid, created_at, updated_at, last_login_at FROM users WHERE openid = $1", [cleanOpenid(openid)]);
  return result.rows[0] || null;
}

async function findOrCreateByOpenid(openid) {
  const value = cleanOpenid(openid); if (!value) throw new Error("OPENID_REQUIRED");
  const db = getPool(); if (!db) return { id: null, openid: value };
  const result = await db.query(
    "INSERT INTO users (openid) VALUES ($1) ON CONFLICT (openid) DO UPDATE SET updated_at = NOW() RETURNING id, openid, created_at, updated_at, last_login_at",
    [value]
  );
  return result.rows[0];
}

async function touchLogin(openid) {
  const db = getPool(); if (!db) return null;
  const result = await db.query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE openid = $1 RETURNING id, openid, last_login_at", [cleanOpenid(openid)]);
  return result.rows[0] || null;
}

async function deleteUser(openid) {
  const db = getPool(); if (!db) return false;
  const result = await db.query("DELETE FROM users WHERE openid = $1", [cleanOpenid(openid)]);
  return result.rowCount > 0;
}

module.exports = { findByOpenid, findOrCreateByOpenid, touchLogin, deleteUser };
