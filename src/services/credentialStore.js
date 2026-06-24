const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");
const { getUserPaths } = require("./userPaths");

let cachedEnvFile = null;

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

function credentialSecret() {
  return getValue("CREDENTIAL_SECRET") || getValue("JWT_SECRET") || "campus_assistant_secret";
}

function encryptSecret(value) {
  return CryptoJS.AES.encrypt(String(value || ""), credentialSecret()).toString();
}

function decryptSecret(value) {
  try {
    const bytes = CryptoJS.AES.decrypt(String(value || ""), credentialSecret());
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    return "";
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
    const password = data.passwordEnc ? decryptSecret(data.passwordEnc) : String(data.password || "");
    if (!password) return null;
    return {
      studentId: String(data.studentId),
      password,
      source: "account_file"
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
      lastJwxtStatus: data.lastJwxtStatus || "",
      lastJwxtLoginAt: data.lastJwxtLoginAt || null,
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
  const file = accountFile(userId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log("[user-scope] credentialStore.saveAccount scope=" + (userId ? "user" : "legacy"));
  const existing = readBoundAccountMeta(userId) || {};
  fs.writeFileSync(file, JSON.stringify({
    studentId: String(studentId),
    passwordEnc: encryptSecret(password),
    lastJwxtStatus: existing.lastJwxtStatus || "COOKIE_EXPIRED",
    lastJwxtLoginAt: existing.lastJwxtLoginAt || null,
    updatedAt: new Date().toISOString()
  }, null, 2));
}

function updateBoundAccountStatus(userId, status, extra) {
  const file = accountFile(userId);
  if (!fs.existsSync(file)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !data.studentId) return false;
    data.lastJwxtStatus = status || data.lastJwxtStatus || "";
    if (extra && extra.lastJwxtLoginAt !== undefined) data.lastJwxtLoginAt = extra.lastJwxtLoginAt;
    if (extra && extra.clearLastJwxtLoginAt) data.lastJwxtLoginAt = null;
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
  getJwxtCredentials,
  readBoundAccount,
  readBoundAccountMeta,
  hasBoundAccount,
  saveBoundAccount,
  updateBoundAccountStatus,
  deleteBoundAccount
};
