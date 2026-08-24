const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "campus-session-migration-test-"));
process.env.NODE_ENV = "development";
process.env.DATA_DIR = testRoot;
process.env.SESSION_ENCRYPTION_KEY = "migration-fixture-session-key-0123456789-abcdef";

const sessionCrypto = require("../src/services/sessionCrypto");
const migration = require("./migrate-stored-sessions");

const usersDir = path.join(testRoot, "users");
const secretMarkers = ["jwxt-migration-secret", "xg-migration-secret"];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function bytes(file) {
  return fs.readFileSync(file);
}

function digestTree(root) {
  const hash = crypto.createHash("sha256");
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(dir, entry.name);
      const relative = path.relative(root, target).replace(/\\/g, "/");
      hash.update(relative + "\0" + (entry.isDirectory() ? "d" : "f") + "\0");
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) hash.update(fs.readFileSync(target));
    }
  }
  walk(root);
  return hash.digest("hex");
}

try {
  const userDir = path.join(usersDir, "fixture-user");
  const jwxtFile = path.join(userDir, "cookies.json");
  const xgFile = path.join(userDir, "campus.json");
  const jwxt = [{ name: "JSESSIONID", value: secretMarkers[0], domain: "newjwc.tyust.edu.cn", path: "/jwglxt" }];
  const xg = { scoreUrl: "https://xg.tyust.edu.cn/score", cookies: "session=" + secretMarkers[1], updatedAt: "2026-08-14T00:00:00.000Z" };
  const otherFields = { grades: [{ courseName: "kept", score: "91" }], timetable: [{ courseName: "kept" }], marker: { nested: true } };
  writeJson(jwxtFile, jwxt);
  writeJson(xgFile, Object.assign({}, otherFields, { xgSession: xg }));

  const beforeDryRun = digestTree(testRoot);
  const dryRun = migration.migrateUsers({ usersDir, apply: false });
  assert.strictEqual(dryRun.jwxt.eligible, 1);
  assert.strictEqual(dryRun.xg.eligible, 1);
  assert.strictEqual(digestTree(testRoot), beforeDryRun);
  console.log("storedSessionDryRunDefaultNoWriteTest=passed");

  const applied = migration.migrateUsers({ usersDir, apply: true });
  assert.deepStrictEqual(applied.jwxt, { eligible: 1, attempted: 1, migrated: 1, failed: 0 });
  assert.deepStrictEqual(applied.xg, { eligible: 1, attempted: 1, migrated: 1, failed: 0 });
  assert.strictEqual(migration.detectJwxtFile(jwxtFile).state, "ENCRYPTED_VALID");
  assert.strictEqual(migration.detectXgFile(xgFile).state, "ENCRYPTED_VALID");
  assert.deepStrictEqual(sessionCrypto.decryptPayload(JSON.parse(fs.readFileSync(jwxtFile, "utf8")), migration.JWXT_PURPOSE), jwxt);
  const xgDocument = JSON.parse(fs.readFileSync(xgFile, "utf8"));
  assert.deepStrictEqual(sessionCrypto.decryptPayload(xgDocument.xgSession, migration.XG_PURPOSE), xg);
  const preserved = Object.assign({}, xgDocument);
  delete preserved.xgSession;
  assert.deepStrictEqual(preserved, otherFields);
  for (const marker of secretMarkers) {
    assert.strictEqual(fs.readFileSync(jwxtFile, "utf8").includes(marker), false);
    assert.strictEqual(fs.readFileSync(xgFile, "utf8").includes(marker), false);
  }
  console.log("storedSessionAtomicMigrationAndXgPreservationTest=passed");

  const second = migration.migrateUsers({ usersDir, apply: true });
  assert.strictEqual(second.jwxt.eligible, 0);
  assert.strictEqual(second.jwxt.migrated, 0);
  assert.strictEqual(second.xg.eligible, 0);
  assert.strictEqual(second.xg.migrated, 0);
  console.log("storedSessionMigrationIdempotencyTest=passed");

  const interruptedDir = path.join(usersDir, "interrupted-user");
  const interruptedFile = path.join(interruptedDir, "cookies.json");
  writeJson(interruptedFile, jwxt);
  const interruptedBytes = bytes(interruptedFile);
  assert.throws(() => migration.migrateJwxt(interruptedFile, {
    beforeReplace() {
      const error = new Error("simulated interruption");
      error.code = "SIMULATED_INTERRUPTION";
      throw error;
    }
  }), error => error && error.code === "SIMULATED_INTERRUPTION");
  assert.deepStrictEqual(bytes(interruptedFile), interruptedBytes);
  assert.strictEqual(fs.readdirSync(interruptedDir).some(name => name.includes(".session-migrate-")), false);
  console.log("storedSessionInterruptedMigrationLeavesOriginalTest=passed");

  const unknownFile = path.join(usersDir, "unknown-user", "cookies.json");
  writeJson(unknownFile, { format: "unknown-format", payload: "opaque" });
  const unknownBytes = bytes(unknownFile);
  assert.strictEqual(migration.detectJwxtFile(unknownFile).state, "UNKNOWN");
  assert.strictEqual(migration.migrateJwxt(unknownFile).migrated, false);
  assert.deepStrictEqual(bytes(unknownFile), unknownBytes);
  console.log("storedSessionUnknownFormatUntouchedTest=passed");

  const validEnvelope = JSON.parse(fs.readFileSync(jwxtFile, "utf8"));
  const corruptFile = path.join(usersDir, "corrupt-user", "cookies.json");
  const corruptEnvelope = Object.assign({}, validEnvelope, { tag: validEnvelope.tag.slice(0, -4) + "AAAA" });
  writeJson(corruptFile, corruptEnvelope);
  assert.strictEqual(migration.detectJwxtFile(corruptFile).state, "ENCRYPTED_CORRUPT");
  const corruptBytes = bytes(corruptFile);
  assert.strictEqual(migration.migrateJwxt(corruptFile).migrated, false);
  assert.deepStrictEqual(bytes(corruptFile), corruptBytes);
  console.log("storedSessionCorruptCipherFailsClosedTest=passed");

  process.env.SESSION_ENCRYPTION_KEY = "migration-fixture-wrong-key-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  assert.strictEqual(migration.detectJwxtFile(jwxtFile).state, "ENCRYPTED_CORRUPT");
  process.env.SESSION_ENCRYPTION_KEY = "migration-fixture-session-key-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  console.log("storedSessionWrongKeyFailsClosedTest=passed");

  const cliEnv = Object.assign({}, process.env, { DATA_DIR: testRoot });
  const cli = spawnSync(process.execPath, [path.join(__dirname, "migrate-stored-sessions.js"), "--users-dir", usersDir], {
    cwd: path.resolve(__dirname, ".."), env: cliEnv, encoding: "utf8"
  });
  assert.strictEqual(cli.status, 0, cli.stderr);
  const combinedOutput = String(cli.stdout || "") + String(cli.stderr || "");
  for (const marker of secretMarkers) assert.strictEqual(combinedOutput.includes(marker), false);
  assert.strictEqual(combinedOutput.includes(process.env.SESSION_ENCRYPTION_KEY), false);
  assert.throws(() => migration.assertCliScope(path.resolve(testRoot)), error => error && error.code === "MIGRATION_SCOPE_REJECTED");
  assert.strictEqual(fs.readdirSync(testRoot).some(name => /\.bak$|\.old$/.test(name)), false);
  console.log("storedSessionScopeAndSecretLoggingGuardTest=passed");
} finally {
  process.env.SESSION_ENCRYPTION_KEY = "migration-fixture-session-key-0123456789-abcdef";
  sessionCrypto.resetSessionCryptoForTests();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
