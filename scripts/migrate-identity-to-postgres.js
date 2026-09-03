/* One-time, explicit JSON -> PostgreSQL identity/binding migration.
 * Dry-run is the default. Set APPLY_MIGRATION=1 to write; never deletes JSON.
 */
const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const { isPostgresEnabled, closePool } = require("../src/db/pool");
const { migrate } = require("../src/db/migrate");
const userRepository = require("../src/repositories/userRepository");
const bindingRepository = require("../src/repositories/jwxtBindingRepository");

function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; } }
function listUsers() {
  const root = path.join(config.dataDir, "users");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
}

async function main() {
  if (!isPostgresEnabled()) throw new Error("PERSISTENCE_MODE_POSTGRES_REQUIRED");
  await migrate();
  const apply = String(process.env.APPLY_MIGRATION || "") === "1";
  let eligible = 0, migrated = 0, skipped = 0;
  for (const id of listUsers()) {
    const dir = path.join(config.dataDir, "users", id);
    const profile = read(path.join(dir, "profile.json"));
    const account = read(path.join(dir, "account.json"));
    const openid = String((profile && profile.openid) || id || "").trim();
    if (!openid || !account || !account.studentId) { skipped++; continue; }
    eligible++;
    if (!apply) continue;
    await userRepository.findOrCreateByOpenid(openid);
    await bindingRepository.upsertBinding(openid, {
      studentId: account.studentId, passwordEnc: account.passwordEnc,
      portalAuthStatus: account.portalAuthStatus, jwxtStatus: account.jwxtStatus || account.lastJwxtStatus,
      xgStatus: account.xgStatus, lastJwxtLoginAt: account.lastJwxtLoginAt,
      lastSuccessfulSyncAt: account.lastSuccessfulSyncAt, lastFailedSyncAt: account.lastFailedSyncAt,
      lastJwxtError: account.lastJwxtError, lastJwxtErrorMessage: account.lastJwxtErrorMessage,
      lastXgSuccessfulAt: account.lastXgSuccessfulAt
    });
    migrated++;
  }
  console.log(JSON.stringify({ mode: "postgres", dryRun: !apply, eligible, migrated, skipped }));
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error("identity migration failed code=" + (err.code || "MIGRATION_FAILED"));
    process.exitCode = 1;
  } finally {
    try {
      await closePool();
    } catch (err) {
      console.error("identity migration pool close failed");
      process.exitCode = 1;
    }
  }
}

run().catch(() => {
  process.exitCode = 1;
});
