const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  isEncryptedEnvelope,
  encryptPayload,
  decryptPayload
} = require("../src/services/sessionCrypto");

const JWXT_PURPOSE = "jwxt-cookie-session";
const XG_PURPOSE = "xg-score-session";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validJwxtSession(value) {
  return Array.isArray(value) && value.every(cookie =>
    isPlainObject(cookie) &&
    typeof cookie.name === "string" && cookie.name.length > 0 &&
    typeof cookie.value === "string"
  );
}

function validXgSession(value) {
  return isPlainObject(value) &&
    typeof value.scoreUrl === "string" &&
    typeof value.cookies === "string";
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, error };
  }
}

function detectEncrypted(value, purpose, validator) {
  if (!isEncryptedEnvelope(value)) return null;
  try {
    const plaintext = decryptPayload(value, purpose);
    return validator(plaintext)
      ? { state: "ENCRYPTED_VALID", plaintext }
      : { state: "ENCRYPTED_INVALID", plaintext: null };
  } catch (error) {
    return { state: "ENCRYPTED_CORRUPT", plaintext: null };
  }
}

function detectJwxtFile(file) {
  if (!fs.existsSync(file)) return { state: "MISSING" };
  const parsed = readJson(file);
  if (!parsed.ok) return { state: "INVALID" };
  const encrypted = detectEncrypted(parsed.value, JWXT_PURPOSE, validJwxtSession);
  if (encrypted) return encrypted;
  if (validJwxtSession(parsed.value)) return { state: "LEGACY_PLAINTEXT_VALID", plaintext: parsed.value };
  return { state: "UNKNOWN" };
}

function detectXgFile(file) {
  if (!fs.existsSync(file)) return { state: "MISSING" };
  const parsed = readJson(file);
  if (!parsed.ok || !isPlainObject(parsed.value)) return { state: "INVALID" };
  if (!Object.prototype.hasOwnProperty.call(parsed.value, "xgSession") || parsed.value.xgSession == null) {
    return { state: "MISSING" };
  }
  const encrypted = detectEncrypted(parsed.value.xgSession, XG_PURPOSE, validXgSession);
  if (encrypted) return Object.assign(encrypted, { document: parsed.value });
  if (validXgSession(parsed.value.xgSession)) {
    return { state: "LEGACY_PLAINTEXT_VALID", plaintext: parsed.value.xgSession, document: parsed.value };
  }
  return { state: "UNKNOWN", document: parsed.value };
}

function userDirectories(usersDir) {
  if (!fs.existsSync(usersDir)) return [];
  return fs.readdirSync(usersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => path.join(usersDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function initialCounts() {
  return {
    ENCRYPTED_VALID: 0,
    ENCRYPTED_CORRUPT: 0,
    ENCRYPTED_INVALID: 0,
    LEGACY_PLAINTEXT_VALID: 0,
    UNKNOWN: 0,
    INVALID: 0,
    MISSING: 0
  };
}

function inventory(usersDir) {
  const result = { users: 0, jwxt: initialCounts(), xg: initialCounts() };
  for (const userDir of userDirectories(usersDir)) {
    result.users += 1;
    const jwxt = detectJwxtFile(path.join(userDir, "cookies.json"));
    const xg = detectXgFile(path.join(userDir, "campus.json"));
    result.jwxt[jwxt.state] += 1;
    result.xg[xg.state] += 1;
  }
  return result;
}

function writeEncryptedAtomic(file, serialized, verifyTemporary, verifyFinal, hooks) {
  const temporary = file + ".session-migrate-" + process.pid + "-" + Date.now() + ".tmp";
  try {
    fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
    verifyTemporary(temporary);
    if (hooks && typeof hooks.beforeReplace === "function") hooks.beforeReplace(file, temporary);
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch (error) {}
    verifyFinal(file);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (cleanupError) {}
    throw error;
  }
}

function migrateJwxt(file, hooks) {
  const detected = detectJwxtFile(file);
  if (detected.state !== "LEGACY_PLAINTEXT_VALID") return { state: detected.state, migrated: false };
  const originalBytes = fs.readFileSync(file, "utf8");
  const original = detected.plaintext;
  const envelope = encryptPayload(original, JWXT_PURPOSE);
  const serialized = JSON.stringify(envelope, null, 2);
  assert.strictEqual(serialized.includes(originalBytes), false);
  const verify = candidate => {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    assert.deepStrictEqual(decryptPayload(parsed, JWXT_PURPOSE), original);
  };
  writeEncryptedAtomic(file, serialized, verify, verify, hooks);
  return { state: "ENCRYPTED_VALID", migrated: true };
}

function withoutXgSession(document) {
  const copy = Object.assign({}, document);
  delete copy.xgSession;
  return copy;
}

function migrateXg(file, hooks) {
  const detected = detectXgFile(file);
  if (detected.state !== "LEGACY_PLAINTEXT_VALID") return { state: detected.state, migrated: false };
  const original = detected.plaintext;
  const originalOtherFields = withoutXgSession(detected.document);
  const next = Object.assign({}, detected.document, {
    xgSession: encryptPayload(original, XG_PURPOSE)
  });
  assert.deepStrictEqual(withoutXgSession(next), originalOtherFields);
  const serialized = JSON.stringify(next, null, 2);
  const verify = candidate => {
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    assert.deepStrictEqual(withoutXgSession(parsed), originalOtherFields);
    assert.deepStrictEqual(decryptPayload(parsed.xgSession, XG_PURPOSE), original);
  };
  writeEncryptedAtomic(file, serialized, verify, verify, hooks);
  return { state: "ENCRYPTED_VALID", migrated: true };
}

function migrateUsers(options) {
  const usersDir = path.resolve(options && options.usersDir || "");
  const apply = Boolean(options && options.apply);
  const hooks = options && options.hooks;
  const before = inventory(usersDir);
  const result = {
    mode: apply ? "APPLY" : "DRY_RUN",
    usersDir,
    before,
    jwxt: { eligible: before.jwxt.LEGACY_PLAINTEXT_VALID, attempted: 0, migrated: 0, failed: 0 },
    xg: { eligible: before.xg.LEGACY_PLAINTEXT_VALID, attempted: 0, migrated: 0, failed: 0 }
  };
  if (!apply) return Object.assign(result, { after: before });

  for (const userDir of userDirectories(usersDir)) {
    const jwxtFile = path.join(userDir, "cookies.json");
    if (detectJwxtFile(jwxtFile).state === "LEGACY_PLAINTEXT_VALID") {
      result.jwxt.attempted += 1;
      try {
        if (migrateJwxt(jwxtFile, hooks).migrated) result.jwxt.migrated += 1;
      } catch (error) {
        result.jwxt.failed += 1;
        if (options && options.stopOnError !== false) throw error;
      }
    }

    const xgFile = path.join(userDir, "campus.json");
    if (detectXgFile(xgFile).state === "LEGACY_PLAINTEXT_VALID") {
      result.xg.attempted += 1;
      try {
        if (migrateXg(xgFile, hooks).migrated) result.xg.migrated += 1;
      } catch (error) {
        result.xg.failed += 1;
        if (options && options.stopOnError !== false) throw error;
      }
    }
  }
  result.after = inventory(usersDir);
  return result;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const apply = args.includes("--apply");
  const index = args.indexOf("--users-dir");
  if (index < 0 || !args[index + 1]) {
    const error = new Error("--users-dir is required");
    error.code = "USERS_DIR_REQUIRED";
    throw error;
  }
  return { apply, usersDir: path.resolve(args[index + 1]) };
}

function assertCliScope(usersDir) {
  const configuredDataDir = path.resolve(String(process.env.DATA_DIR || path.join(__dirname, "..", "data")));
  const expected = path.join(configuredDataDir, "users");
  if (path.resolve(usersDir) !== expected) {
    const error = new Error("Migration scope must be exactly DATA_DIR/users");
    error.code = "MIGRATION_SCOPE_REJECTED";
    throw error;
  }
}

function printSummary(result) {
  console.log("mode=" + result.mode);
  console.log("users=" + result.before.users);
  console.log("jwxtEligible=" + result.jwxt.eligible);
  console.log("jwxtAttempted=" + result.jwxt.attempted);
  console.log("jwxtMigrated=" + result.jwxt.migrated);
  console.log("jwxtFailed=" + result.jwxt.failed);
  console.log("xgEligible=" + result.xg.eligible);
  console.log("xgAttempted=" + result.xg.attempted);
  console.log("xgMigrated=" + result.xg.migrated);
  console.log("xgFailed=" + result.xg.failed);
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv);
    assertCliScope(options.usersDir);
    const result = migrateUsers(options);
    printSummary(result);
  } catch (error) {
    console.error("migrationError=" + String(error && error.code || "MIGRATION_FAILED"));
    process.exitCode = 1;
  }
}

module.exports = {
  JWXT_PURPOSE,
  XG_PURPOSE,
  validJwxtSession,
  validXgSession,
  detectJwxtFile,
  detectXgFile,
  inventory,
  migrateJwxt,
  migrateXg,
  migrateUsers,
  assertCliScope
};
