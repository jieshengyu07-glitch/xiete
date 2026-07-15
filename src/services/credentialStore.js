const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");
const { getUserPaths } = require("./userPaths");

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
  fs.writeFileSync(file, JSON.stringify({
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
    updatedAt: new Date().toISOString()
  }, null, 2));
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
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    return false;
  }
}

function deleteBoundAccount(userId) {
  const file = accountFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  assertCredentialConfig,
  getJwxtCredentials,
  readBoundAccount,
  readBoundAccountMeta,
  hasBoundAccount,
  saveBoundAccount,
  updateBoundAccountStatus,
  deleteBoundAccount
};

if (process.env.NODE_ENV !== "development") {
  assertCredentialConfig();
}
