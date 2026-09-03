const { assertPersistenceConfig, isPostgresEnabled, closePool } = require("./pool");
const { migrate } = require("./migrate");

async function initializePersistence() {
  assertPersistenceConfig();
  if (isPostgresEnabled()) await migrate();
  return { mode: isPostgresEnabled() ? "postgres" : "json" };
}

module.exports = { initializePersistence, closePool };
