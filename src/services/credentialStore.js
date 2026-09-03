const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");
const { getUserPaths } = require("./userPaths");
const { isPostgresEnabled } = require("../db/pool");
const userRepository = require("../repositories/userRepository");
const jwxtBindingRepository = require("../repositories/jwxtBindingRepository");

const MIN_SECRET_LENGTH = 32;
const EXAMPLE_SECRETS = new Set([
  "campus_assistant_secret",
  "change_me_to_a_long_random_secret",
  "change_me_to_a_long_random_credential_secret",
  "your_credential_secret",
  "your_credential_secret_here"
]);

let cachedEnvFile = null;
let validatedCredentialSecret = null;
const migrationWarnings = new Set();

function writeJsonAtomic(file, data) {
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } catch (err) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (cleanupErr) {}
    throw err;
  }
}

function readEnvFile() {
  if (cachedEnvFile) return cachedEnvFile;

  const envPath = path.join(__dirname, "..", "..", ".env");
  const values = {};

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    });
  }

  cachedEnvFile = values;
  return cachedEnvFile;
}

function getValue(name) {
  return process.env[name] || readEnvFile()[name] || "";
}

function assertCredentialConfig() {
  if (validatedCredentialSecret) return validatedCredentialSecret;

  const configuredSecret = String(getValue("CREDENTIAL_SECRET") || "");
  const normalizedSecret = configuredSecret.trim();

  if (!normalizedSecret) {
    throw new Error("CREDENTIAL_SECRET is required");
  }

  if (normalizedSecret.length < MIN_SECRET_LENGTH) {
    throw new Error("CREDENTIAL_SECRET must be at least " + MIN_SECRET_LENGTH + " characters long");
  }

  if (EXAMPLE_SECRETS.has(normalizedSecret.toLowerCase())) {
    throw new Error("CREDENTIAL_SECRET must not use an example value");
  }

  const jwtSecret = String(getValue("JWT_SECRET") || "").trim();
  if (jwtSecret && normalizedSecret === jwtSecret) {
    throw new Error("CREDENTIAL_SECRET must be independent from JWT_SECRET");
  }

  validatedCredentialSecret = configuredSecret;
  return validatedCredentialSecret;
}

function encryptSecret(value) {
  return CryptoJS.AES.encrypt(String(value || ""), assertCredentialConfig()).toString();
}

function decryptWithSecret(value, secret) {
  try {
    const bytes = CryptoJS.AES.decrypt(String(value || ""), secret);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    return "";
  }
}

function migrationHint(file, reason) {
  const label = file || "encrypted account data";
  const key = label + ":" + reason;
  if (migrationWarnings.has(key)) return;
  migrationWarnings.add(key);
  console.error(
    "[security] Credential migration required for " + label + ": " + reason +
    ". Existing encrypted data was not overwritten. Configure LEGACY_CREDENTIAL_SECRET for read-only recovery and migrate it explicitly."
  );
}

function decryptSecretDetails(value, file) {
  const currentSecret = assertCredentialConfig();
  const currentValue = decryptWithSecret(value, currentSecret);
  if (currentValue) return { value: currentValue, usedLegacySecret: false };

  const legacySecret = String(getValue("LEGACY_CREDENTIAL_SECRET") || "");
  if (legacySecret && legacySecret !== currentSecret) {
    const legacyValue = decryptWithSecret(value, legacySecret);
    if (legacyValue) {
      migrationHint(file, "data is encrypted with LEGACY_CREDENTIAL_SECRET");
      return { value: legacyValue, usedLegacySecret: true };
    }
  }

  migrationHint(file, "data cannot be decrypted with the configured CREDENTIAL_SECRET");
  return { value: "", usedLegacySecret: false };
}

function ensureExistingEncryptedAccountWritable(file) {
  if (!fs.existsSync(file)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return;
  }
  if (!data || !data.passwordEnc) return;

  const decrypted = decryptSecretDetails(data.passwordEnc, file);
  if (!decrypted.value || decrypted.usedLegacySecret) {
    const err = new Error("Existing credential data requires explicit migration and was not overwritten");
    err.code = "CREDENTIAL_MIGRATION_REQUIRED";
    throw err;
  }
}

function accountFile(userId) {
  return getUserPaths(userId).accountPath;
}

function getJwxtCredentials(userId) {
  if (userId) {
    return readBoundAccount(userId);
  }

  const studentId = getValue("JWXT_STUDENT_ID");
  const password = getValue("JWXT_PASSWORD");

  if (studentId && password) {
    return { studentId, password, source: "env" };
  }

  return readBoundAccount(userId);
}

function readBoundAccount(userId) {
  const file = accountFile(userId);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !data.studentId) return null;
    const decrypted = data.passwordEnc
      ? decryptSecretDetails(data.passwordEnc, file)
      : { value: String(data.password || ""), usedLegacySecret: false };
    const password = decrypted.value;
    if (!password) return null;
    return {
      studentId: String(data.studentId),
      password,
      source: decrypted.usedLegacySecret ? "account_file_legacy_key" : "account_file",
      migrationRequired: decrypted.usedLegacySecret
    };
  } catch (err) {
    return null;
  }
}

function readBoundAccountMeta(userId) {
  const file = accountFile(userId);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !data.studentId) return null;
    return {
      studentId: String(data.studentId),
      hasPassword: Boolean(data.passwordEnc || data.password),
      portalAuthStatus: data.portalAuthStatus || "",
      boundAt: data.boundAt || data.updatedAt || null,
      jwxtStatus: data.jwxtStatus || data.lastJwxtStatus || "",
      lastJwxtStatus: data.lastJwxtStatus || "",
      lastJwxtLoginAt: data.lastJwxtLoginAt || null,
      lastSuccessfulSyncAt: data.lastSuccessfulSyncAt || null,
      lastFailedSyncAt: data.lastFailedSyncAt || null,
      lastJwxtError: data.lastJwxtError || null,
      lastJwxtErrorMessage: data.lastJwxtErrorMessage || null,
      xgStatus: data.xgStatus || "",
      lastXgSuccessfulAt: data.lastXgSuccessfulAt || null,
      updatedAt: data.updatedAt || null,
      source: "account_file"
    };
  } catch (err) {
    return null;
  }
}

function hasBoundAccount(userId) {
  return Boolean(readBoundAccountMeta(userId));
}

function saveBoundAccount(studentId, password, userId) {
  assertCredentialConfig();
  const file = accountFile(userId);
  ensureExistingEncryptedAccountWritable(file);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log("[user-scope] credentialStore.saveAccount scope=" + (userId ? "user" : "legacy"));
  const existing = readBoundAccountMeta(userId) || {};
  writeJsonAtomic(file, {
    studentId: String(studentId),
    passwordEnc: encryptSecret(password),
    boundAt: existing.boundAt || new Date().toISOString(),
    portalAuthStatus: "OK",
    jwxtStatus: existing.jwxtStatus || existing.lastJwxtStatus || "COOKIE_EXPIRED",
    lastJwxtStatus: existing.lastJwxtStatus || "COOKIE_EXPIRED",
    lastJwxtLoginAt: existing.lastJwxtLoginAt || null,
    lastSuccessfulSyncAt: existing.lastSuccessfulSyncAt || null,
    lastFailedSyncAt: existing.lastFailedSyncAt || null,
    lastJwxtError: existing.lastJwxtError || null,
    lastJwxtErrorMessage: existing.lastJwxtErrorMessage || null,
    xgStatus: existing.xgStatus || "",
    lastXgSuccessfulAt: existing.lastXgSuccessfulAt || null,
    updatedAt: new Date().toISOString()
  });
}

function updateBoundAccountStatus(userId, status, extra) {
  const file = accountFile(userId);
  if (!fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !data.studentId) return false;
    data.jwxtStatus = status || data.jwxtStatus || data.lastJwxtStatus || "";
    data.lastJwxtStatus = status || data.lastJwxtStatus || "";
    if (extra && extra.portalAuthStatus) data.portalAuthStatus = extra.portalAuthStatus;
    if (extra && extra.lastJwxtLoginAt !== undefined) data.lastJwxtLoginAt = extra.lastJwxtLoginAt;
    if (extra && extra.clearLastJwxtLoginAt) data.lastJwxtLoginAt = null;
    if (extra && extra.lastSuccessfulSyncAt !== undefined) data.lastSuccessfulSyncAt = extra.lastSuccessfulSyncAt;
    if (extra && extra.lastFailedSyncAt !== undefined) data.lastFailedSyncAt = extra.lastFailedSyncAt;
    if (extra && extra.lastJwxtError !== undefined) data.lastJwxtError = extra.lastJwxtError;
    if (extra && extra.lastJwxtErrorMessage !== undefined) data.lastJwxtErrorMessage = extra.lastJwxtErrorMessage;
    if (extra && extra.xgStatus !== undefined) data.xgStatus = extra.xgStatus;
    if (extra && extra.lastXgSuccessfulAt !== undefined) data.lastXgSuccessfulAt = extra.lastXgSuccessfulAt;
    data.updatedAt = new Date().toISOString();
    writeJsonAtomic(file, data);
    return true;
  } catch (err) {
    return false;
  }
}

function deleteBoundAccount(userId) {
  const file = accountFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function readJsonAccount(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

async function ensurePostgresUser(userId) {
  if (!isPostgresEnabled()) return null;
  return userRepository.findOrCreateByOpenid(userId);
}

async function readBoundAccountMetaAsync(userId) {
  if (!isPostgresEnabled()) return readBoundAccountMeta(userId);
  await ensurePostgresUser(userId);
  const row = await jwxtBindingRepository.findByOpenid(userId);
  if (row) return jwxtBindingRepository.toMeta(row);
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return null;
  const legacy = readBoundAccountMeta(userId);
  if (!legacy) return null;
  const raw = readJsonAccount(accountFile(userId));
  await jwxtBindingRepository.upsertBinding(userId, {
    studentId: legacy.studentId, passwordEnc: raw && raw.passwordEnc,
    portalAuthStatus: legacy.portalAuthStatus, jwxtStatus: legacy.jwxtStatus,
    xgStatus: legacy.xgStatus, lastJwxtLoginAt: legacy.lastJwxtLoginAt,
    lastSuccessfulSyncAt: legacy.lastSuccessfulSyncAt, lastFailedSyncAt: legacy.lastFailedSyncAt,
    lastJwxtError: legacy.lastJwxtError, lastJwxtErrorMessage: legacy.lastJwxtErrorMessage,
    lastXgSuccessfulAt: legacy.lastXgSuccessfulAt
  });
  return legacy;
}

async function getJwxtCredentialsAsync(userId) {
  if (!isPostgresEnabled()) return getJwxtCredentials(userId);
  await readBoundAccountMetaAsync(userId);
  const row = await jwxtBindingRepository.findByOpenid(userId);
  if (!row) return null;
  if (!row.password_enc) {
    const err = new Error("Bound campus credentials are unavailable");
    err.code = "CREDENTIALS_UNAVAILABLE";
    throw err;
  }
  const decrypted = decryptSecretDetails(row.password_enc, "postgres jwxt_bindings");
  if (!decrypted.value) {
    const err = new Error("Bound campus credentials could not be decrypted");
    err.code = "CREDENTIALS_UNAVAILABLE";
    throw err;
  }
  return { studentId: String(row.student_id), password: decrypted.value, source: "postgres" };
}

async function saveBoundAccountAsync(studentId, password, userId) {
  if (!isPostgresEnabled()) return saveBoundAccount(studentId, password, userId);
  await ensurePostgresUser(userId);
  const existing = await readBoundAccountMetaAsync(userId);
  await jwxtBindingRepository.upsertBinding(userId, {
    studentId: String(studentId), passwordEnc: encryptSecret(password), portalAuthStatus: "OK",
    jwxtStatus: existing && existing.jwxtStatus || "COOKIE_EXPIRED",
    xgStatus: existing && existing.xgStatus || "",
    lastJwxtLoginAt: existing && existing.lastJwxtLoginAt,
    lastSuccessfulSyncAt: existing && existing.lastSuccessfulSyncAt,
    lastFailedSyncAt: existing && existing.lastFailedSyncAt,
    lastJwxtError: existing && existing.lastJwxtError,
    lastJwxtErrorMessage: existing && existing.lastJwxtErrorMessage,
    lastXgSuccessfulAt: existing && existing.lastXgSuccessfulAt
  });
}

async function updateBoundAccountStatusAsync(userId, status, extra) {
  if (!isPostgresEnabled()) return updateBoundAccountStatus(userId, status, extra);
  const existing = await readBoundAccountMetaAsync(userId);
  if (!existing) return false;
  const patch = extra || {};
  const row = await jwxtBindingRepository.findByOpenid(userId);
  await jwxtBindingRepository.upsertBinding(userId, {
    studentId: existing.studentId, passwordEnc: row && row.password_enc,
    jwxtStatus: status || existing.jwxtStatus,
    portalAuthStatus: patch.portalAuthStatus || existing.portalAuthStatus,
    xgStatus: patch.xgStatus !== undefined ? patch.xgStatus : existing.xgStatus,
    lastJwxtLoginAt: patch.clearLastJwxtLoginAt ? null : (patch.lastJwxtLoginAt !== undefined ? patch.lastJwxtLoginAt : existing.lastJwxtLoginAt),
    lastSuccessfulSyncAt: patch.lastSuccessfulSyncAt !== undefined ? patch.lastSuccessfulSyncAt : existing.lastSuccessfulSyncAt,
    lastFailedSyncAt: patch.lastFailedSyncAt !== undefined ? patch.lastFailedSyncAt : existing.lastFailedSyncAt,
    lastJwxtError: patch.lastJwxtError !== undefined ? patch.lastJwxtError : existing.lastJwxtError,
    lastJwxtErrorMessage: patch.lastJwxtErrorMessage !== undefined ? patch.lastJwxtErrorMessage : existing.lastJwxtErrorMessage,
    lastXgSuccessfulAt: patch.lastXgSuccessfulAt !== undefined ? patch.lastXgSuccessfulAt : existing.lastXgSuccessfulAt
  });
  return true;
}

async function deleteBoundAccountAsync(userId) {
  if (!isPostgresEnabled()) return deleteBoundAccount(userId);
  return jwxtBindingRepository.deleteBinding(userId);
}

module.exports = {
  assertCredentialConfig,
  getJwxtCredentials,
  readBoundAccount,
  readBoundAccountMeta,
  hasBoundAccount,
  saveBoundAccount,
  updateBoundAccountStatus,
  deleteBoundAccount,
  readBoundAccountMetaAsync,
  getJwxtCredentialsAsync,
  saveBoundAccountAsync,
  updateBoundAccountStatusAsync,
  deleteBoundAccountAsync,
  ensurePostgresUser
};

if (process.env.NODE_ENV !== "development") {
  assertCredentialConfig();
}
