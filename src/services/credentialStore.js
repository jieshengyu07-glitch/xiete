const fs = require("fs");
const path = require("path");

let cachedEnvFile = null;
const ACCOUNT_FILE = path.join(__dirname, "..", "..", "data", "users", "account.json");

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

function getJwxtCredentials() {
  const studentId = getValue("JWXT_STUDENT_ID");
  const password = getValue("JWXT_PASSWORD");

  if (studentId && password) {
    return { studentId, password, source: "env" };
  }

  return readBoundAccount();
}

function readBoundAccount() {
  if (!fs.existsSync(ACCOUNT_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8"));
    if (!data || !data.studentId || !data.password) return null;
    return {
      studentId: String(data.studentId),
      password: String(data.password),
      source: "account_file"
    };
  } catch (err) {
    return null;
  }
}

function saveBoundAccount(studentId, password) {
  const dir = path.dirname(ACCOUNT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({
    studentId: String(studentId),
    password: String(password),
    updatedAt: new Date().toISOString()
  }, null, 2));
}

function deleteBoundAccount() {
  if (fs.existsSync(ACCOUNT_FILE)) fs.unlinkSync(ACCOUNT_FILE);
}

module.exports = {
  getJwxtCredentials,
  readBoundAccount,
  saveBoundAccount,
  deleteBoundAccount
};
