const { Pool } = require("pg");

let pool = null;

function isPostgresEnabled() {
  const mode = String(process.env.PERSISTENCE_MODE || "").trim().toLowerCase();
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && mode === "json" && process.env.PERSISTENCE_TEST_MODE === "1") return false;
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return true;
  return Boolean(String(process.env.DATABASE_URL || "").trim()) || mode === "postgres";
}

function assertPersistenceConfig() {
  const production = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const mode = String(process.env.PERSISTENCE_MODE || "").trim().toLowerCase();
  if (production && mode && mode !== "postgres" && process.env.PERSISTENCE_TEST_MODE !== "1") {
    const err = new Error("JSON persistence is forbidden in production");
    err.code = "PRODUCTION_JSON_PERSISTENCE_FORBIDDEN";
    throw err;
  }
  if (production && !String(process.env.DATABASE_URL || "").trim() && process.env.PERSISTENCE_TEST_MODE !== "1") {
    const err = new Error("DATABASE_URL is required in production");
    err.code = "DATABASE_URL_REQUIRED";
    throw err;
  }
  return isPostgresEnabled();
}

function getPool() {
  if (!isPostgresEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: String(process.env.DATABASE_SSL || "").toLowerCase() === "false" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { isPostgresEnabled, assertPersistenceConfig, getPool, closePool };
