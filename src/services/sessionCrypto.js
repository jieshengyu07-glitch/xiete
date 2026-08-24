const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FORMAT = "campus-secure-v1";
const ALGORITHM = "aes-256-gcm";
const MIN_SECRET_LENGTH = 32;
const EXAMPLE_SECRETS = new Set([
  "set_a_unique_random_value_of_at_least_32_characters",
  "change_me_to_a_long_random_session_secret",
  "your_session_encryption_key"
]);

let validatedSecret = null;

function sessionSecret() {
  if (validatedSecret && validatedSecret.source === process.env.SESSION_ENCRYPTION_KEY) {
    return validatedSecret.value;
  }
  const source = String(process.env.SESSION_ENCRYPTION_KEY || "");
  const value = source.trim();
  if (!value) {
    const err = new Error("SESSION_ENCRYPTION_KEY is required");
    err.code = "SESSION_ENCRYPTION_UNAVAILABLE";
    throw err;
  }
  if (value.length < MIN_SECRET_LENGTH || EXAMPLE_SECRETS.has(value.toLowerCase())) {
    const err = new Error("SESSION_ENCRYPTION_KEY must be a non-example value of at least 32 characters");
    err.code = "SESSION_ENCRYPTION_UNAVAILABLE";
    throw err;
  }
  if (value === String(process.env.JWT_SECRET || "").trim()) {
    const err = new Error("SESSION_ENCRYPTION_KEY must be independent from JWT_SECRET");
    err.code = "SESSION_ENCRYPTION_UNAVAILABLE";
    throw err;
  }
  validatedSecret = { source, value };
  return value;
}

function assertSessionEncryptionConfig() {
  sessionSecret();
  return true;
}

function deriveKey(purpose) {
  return crypto.hkdfSync(
    "sha256",
    Buffer.from(sessionSecret(), "utf8"),
    Buffer.from("campus-assistant-session-storage", "utf8"),
    Buffer.from(String(purpose || "campus-session"), "utf8"),
    32
  );
}

function isEncryptedEnvelope(value) {
  return Boolean(value && typeof value === "object" && value.format === FORMAT &&
    value.algorithm === ALGORITHM && value.payload && value.iv && value.tag);
}

function encryptPayload(value, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(purpose), iv);
  cipher.setAAD(Buffer.from(FORMAT + ":" + String(purpose || "campus-session"), "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: FORMAT,
    version: 1,
    encrypted: true,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64")
  };
}

function decryptPayload(envelope, purpose) {
  if (!isEncryptedEnvelope(envelope)) {
    const err = new Error("Unsupported encrypted session format");
    err.code = "SESSION_DECRYPT_FAILED";
    throw err;
  }
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      deriveKey(purpose),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAAD(Buffer.from(FORMAT + ":" + String(purpose || "campus-session"), "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, "base64")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch (cause) {
    const err = new Error("Encrypted campus session could not be decrypted");
    err.code = "SESSION_DECRYPT_FAILED";
    throw err;
  }
}

function writeJsonAtomic(file, value) {
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch (err) {}
  } catch (err) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (cleanupErr) {}
    throw err;
  }
}

function writeEncryptedJsonAtomic(file, value, purpose) {
  writeJsonAtomic(file, encryptPayload(value, purpose));
}

function resetSessionCryptoForTests() {
  validatedSecret = null;
}

module.exports = {
  FORMAT,
  ALGORITHM,
  assertSessionEncryptionConfig,
  isEncryptedEnvelope,
  encryptPayload,
  decryptPayload,
  writeJsonAtomic,
  writeEncryptedJsonAtomic,
  resetSessionCryptoForTests
};
