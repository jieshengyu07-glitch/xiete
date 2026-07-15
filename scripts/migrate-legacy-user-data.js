const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.resolve(String(process.env.DATA_DIR || path.join(projectRoot, "data")));
process.env.DATA_DIR = dataDir;

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function firstValue(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && String(object[key])) {
        return String(object[key]);
      }
    }
  }
  return "";
}

function userIdFrom(record, hint) {
  const sources = [record, record && record.profile, record && record.wechat, record && record.user];
  const candidate = firstValue(sources, ["openid", "openId", "open_id", "userId", "user_id", "uid"]) || String(hint || "");
  if (!candidate || !/^[a-zA-Z0-9_-]+$/.test(candidate)) return "";
  return candidate;
}

function collectUsers(campus) {
  const users = new Map();
  const add = (record, hint) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    const userId = userIdFrom(record, hint);
    if (!userId) return;
    const previous = users.get(userId) || {};
    users.set(userId, Object.assign({}, previous, record));
  };

  const addContainer = container => {
    if (Array.isArray(container)) {
      container.forEach(record => add(record));
      return;
    }
    if (!container || typeof container !== "object") return;
    Object.entries(container).forEach(([hint, record]) => add(record, hint));
  };

  if (!campus || typeof campus !== "object") return users;
  ["users", "accounts", "userAccounts", "userData", "profiles"].forEach(key => addContainer(campus[key]));
  add(campus.user);
  add(campus.profile);
  add(campus);
  return users;
}

function accountParts(record) {
  const sources = [record && record.account, record && record.credentials, record && record.profile, record];
  const studentId = firstValue(sources, ["studentId", "student_id", "studentNo", "student_no", "xh", "username"]);
  const username = firstValue(sources, ["username", "studentId", "student_id", "studentNo", "student_no", "xh"]);
  const password = firstValue(sources, ["password", "passwd"]);
  const passwordEnc = firstValue(sources, ["passwordEnc", "password_enc"]);
  if (!studentId || (!password && !passwordEnc)) return null;
  return { studentId, username: username || studentId, password, passwordEnc };
}

function encryptedPassword(parts) {
  const credentialStore = require("../src/services/credentialStore");
  const secret = credentialStore.assertCredentialConfig();
  if (parts.passwordEnc) {
    let plaintext = CryptoJS.AES.decrypt(parts.passwordEnc, secret).toString(CryptoJS.enc.Utf8);
    const legacySecret = String(process.env.LEGACY_CREDENTIAL_SECRET || "");
    if (!plaintext && legacySecret && legacySecret !== secret) {
      plaintext = CryptoJS.AES.decrypt(parts.passwordEnc, legacySecret).toString(CryptoJS.enc.Utf8);
    }
    if (!plaintext) {
      const err = new Error("Legacy encrypted credential cannot be decrypted");
      err.code = "CREDENTIAL_MIGRATION_REQUIRED";
      throw err;
    }
    return CryptoJS.AES.encrypt(plaintext, secret).toString();
  }
  return CryptoJS.AES.encrypt(parts.password, secret).toString();
}

function buildAccount(record) {
  const parts = accountParts(record);
  if (!parts) return null;
  const now = new Date().toISOString();
  return {
    studentId: parts.studentId,
    username: parts.username,
    passwordEnc: encryptedPassword(parts),
    boundAt: now,
    portalAuthStatus: "OK",
    jwxtStatus: "COOKIE_EXPIRED",
    lastJwxtStatus: "COOKIE_EXPIRED",
    lastJwxtLoginAt: null,
    lastSuccessfulSyncAt: null,
    lastFailedSyncAt: null,
    lastJwxtError: null,
    lastJwxtErrorMessage: null,
    updatedAt: now
  };
}

function campusPayload(record, rootCampus, userCount) {
  const nested = record && (record.campus || record.storage || record.data);
  const source = nested && typeof nested === "object"
    ? nested
    : (userCount === 1 ? Object.assign({}, rootCampus, record) : record);
  const allowed = [
    "grades",
    "gradeChanges",
    "timetable",
    "evaluation",
    "syncMeta",
    "xgSession",
    "xgUnmatchedCandidates",
    "lastRunAt"
  ];
  const payload = {};
  allowed.forEach(key => {
    if (source && source[key] !== undefined) payload[key] = source[key];
  });
  return payload;
}

function selectUserValue(source, userId, studentId, userCount, valueKey) {
  if (source === null || source === undefined) return null;
  if (Array.isArray(source)) {
    if (valueKey === "cookies") {
      const wrapped = source.find(item => item && userIdFrom(item) === userId && Array.isArray(item.cookies));
      if (wrapped) return wrapped.cookies;
      const looksLikeCookies = source.every(item => item && typeof item === "object" && "name" in item && "value" in item);
      return looksLikeCookies && userCount === 1 ? source : null;
    }
    const identified = source.filter(item => {
      if (!item || typeof item !== "object") return false;
      const itemUserId = userIdFrom(item);
      if (itemUserId) return itemUserId === userId;
      const itemStudentId = firstValue([item], ["studentId", "student_id", "xh"]);
      return Boolean(studentId && itemStudentId && itemStudentId === studentId);
    });
    if (identified.length) return identified;
    return userCount === 1 ? source : null;
  }
  if (typeof source !== "object") return null;
  if (source[userId] !== undefined) return selectUserValue(source[userId], userId, studentId, 1, valueKey);
  if (source.users && source.users[userId] !== undefined) {
    return selectUserValue(source.users[userId], userId, studentId, 1, valueKey);
  }
  if (source[valueKey] !== undefined) return selectUserValue(source[valueKey], userId, studentId, userCount, valueKey);
  return null;
}

function normalizeGrades(value, updatedAt) {
  if (!Array.isArray(value)) return null;
  return { updatedAt: updatedAt || null, grades: value };
}

function writeNewJson(file, value, mode) {
  if (fs.existsSync(file)) return "skip-existing";
  if (typeof value === "function") value = value();
  if (value === null || value === undefined) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".migrate-" + process.pid + "-" + Date.now() + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: mode || 0o600
    });
    fs.linkSync(temporary, file);
  } catch (err) {
    if (err && err.code === "EEXIST") return "skip-existing";
    throw err;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}

function publicUserId(userId) {
  if (userId.length <= 10) return userId.slice(0, 3) + "...";
  return userId.slice(0, 6) + "..." + userId.slice(-4);
}

function migrateLegacyUserData() {
  const campus = readJson(path.join(dataDir, "campus.json"));
  const legacyCookies = readJson(path.join(dataDir, "cookies.json"));
  const legacyGrades = readJson(path.join(dataDir, "grades.json"));
  const users = collectUsers(campus);
  if (!users.size) {
    console.error("[migrate] no-users");
    return { migrated: 0, failed: true };
  }

  for (const [userId, record] of users) {
    const userDir = path.join(dataDir, "users", userId);
    const parts = accountParts(record);
    const studentId = parts ? parts.studentId : "";
    const userCampus = campusPayload(record, campus, users.size);
    const selectedGrades = selectUserValue(legacyGrades, userId, studentId, users.size, "grades") ||
      (Array.isArray(userCampus.grades) ? userCampus.grades : null);
    const selectedCookies = selectUserValue(legacyCookies, userId, studentId, users.size, "cookies");

    const accountResult = writeNewJson(path.join(userDir, "account.json"), () => buildAccount(record));
    writeNewJson(path.join(userDir, "campus.json"), userCampus);
    const gradesResult = writeNewJson(
      path.join(userDir, "grades.json"),
      normalizeGrades(selectedGrades, userCampus.lastRunAt)
    );
    const cookiesResult = writeNewJson(path.join(userDir, "cookies.json"), selectedCookies);

    console.log(
      "[migrate] user=" + publicUserId(userId) +
      " account=" + accountResult +
      " grades=" + gradesResult +
      " cookies=" + cookiesResult
    );
  }
  return { migrated: users.size, failed: false };
}

if (require.main === module) {
  try {
    const result = migrateLegacyUserData();
    if (result.failed) process.exitCode = 1;
  } catch (err) {
    console.error("[migrate] failed code=" + String(err && err.code || "MIGRATION_FAILED"));
    process.exitCode = 1;
  }
}

module.exports = {
  collectUsers,
  migrateLegacyUserData
};
