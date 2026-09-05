const assert = require("assert");
const path = require("path");

async function main() {
  const poolPath = require.resolve(path.resolve(__dirname, "../src/db/pool.js"));
  const migrationPath = require.resolve(path.resolve(__dirname, "../src/db/migrate.js"));
  const originalPoolCache = require.cache[poolPath];
  const originalMigrationCache = require.cache[migrationPath];
  const queries = [];
  const client = {
    async query(sql) { queries.push(String(sql)); },
    release() {}
  };

  try {
    require.cache[poolPath] = {
      id: poolPath,
      filename: poolPath,
      loaded: true,
      exports: { getPool: () => ({ connect: async () => client }) }
    };
    delete require.cache[migrationPath];
    const { migrate } = require(migrationPath);
    await migrate();
    await migrate();
  } finally {
    if (originalPoolCache) require.cache[poolPath] = originalPoolCache;
    else delete require.cache[poolPath];
    if (originalMigrationCache) require.cache[migrationPath] = originalMigrationCache;
    else delete require.cache[migrationPath];
  }

  assert.strictEqual(queries.filter(sql => sql === "BEGIN").length, 2);
  assert.strictEqual(queries.filter(sql => sql === "COMMIT").length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE TABLE IF NOT EXISTS api_request_metrics/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE INDEX IF NOT EXISTS api_request_metrics_occurred_at_idx/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE INDEX IF NOT EXISTS api_request_metrics_route_occurred_at_idx/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE TABLE IF NOT EXISTS monitor_events/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /ALTER TABLE monitor_events ADD COLUMN IF NOT EXISTS stage TEXT/.test(sql)).length, 2);
  assert.ok(queries.filter(sql => /CREATE TABLE IF NOT EXISTS monitor_events/.test(sql)).every(sql => /stage TEXT/.test(sql)));
  assert.strictEqual(queries.filter(sql => /CREATE INDEX IF NOT EXISTS monitor_events_occurred_at_idx/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE INDEX IF NOT EXISTS monitor_events_event_type_occurred_at_idx/.test(sql)).length, 2);
  assert.strictEqual(queries.filter(sql => /CREATE INDEX IF NOT EXISTS monitor_events_user_day_hash_occurred_at_idx/.test(sql)).length, 2);
  ["users", "jwxt_bindings", "campus_cache", "sync_state"].forEach(table => {
    assert.strictEqual(queries.filter(sql => new RegExp("CREATE TABLE IF NOT EXISTS " + table).test(sql)).length, 2);
  });
  console.log("monitoringMigrationIdempotenceTest=passed");
  console.log("monitoringMigrationPreservesCoreSchemaTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
