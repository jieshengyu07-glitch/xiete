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

function saveBoundAccount(studentId, password, userId) {
  const file = accountFile(userId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log("[user-scope] credentialStore.saveAccount scope=" + (userId ? "user" : "legacy"));
  fs.writeFileSync(file, JSON.stringify({
    studentId: String(studentId),
    passwordEnc: encryptSecret(password),
    updatedAt: new Date().toISOString()
  }, null, 2));
}

function deleteBoundAccount(userId) {
  const file = accountFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  getJwxtCredentials,
  readBoundAccount,
  saveBoundAccount,
  deleteBoundAccount
};
