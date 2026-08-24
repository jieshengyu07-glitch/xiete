const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getUserPaths } = require("./userPaths");
const { assertUserDataWritable } = require("./userDataDeletion");
const {
  isEncryptedEnvelope,
  decryptPayload,
  writeEncryptedJsonAtomic
} = require("./sessionCrypto");

const JWXT_PURPOSE = "jwxt-cookie-session";

function cookieFile(userId) {
  return userId ? getUserPaths(userId).cookiesPath : path.join(config.dataDir, "cookies.json");
}

function validCookies(value) {
  return Array.isArray(value) && value.every(cookie => cookie && typeof cookie === "object");
}

function writeCookies(cookies, userId) {
  if (!validCookies(cookies)) {
    const err = new Error("Cookie session must be an array");
    err.code = "SESSION_INVALID";
    throw err;
  }
  if (userId) assertUserDataWritable(userId);
  writeEncryptedJsonAtomic(cookieFile(userId), cookies, JWXT_PURPOSE);
  console.log("[session] jwxt encrypted write scope=" + (userId ? "user" : "legacy") + " count=" + cookies.length);
}

function loadCookies(userId) {
  const file = cookieFile(userId);
  console.log("[session] jwxt load scope=" + (userId ? "user" : "legacy"));
  if (!fs.existsSync(file)) return null;

  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("[security] JWXT session file is invalid; session rejected");
    return null;
  }

  if (isEncryptedEnvelope(stored)) {
    try {
      const cookies = decryptPayload(stored, JWXT_PURPOSE);
      return validCookies(cookies) ? cookies : null;
    } catch (err) {
      console.error("[security] JWXT encrypted session rejected code=" + (err.code || "SESSION_DECRYPT_FAILED"));
      return null;
    }
  }

  if (!validCookies(stored)) {
    console.error("[security] JWXT legacy session format rejected");
    return null;
  }

  try {
    writeCookies(stored, userId);
    console.log("[security] JWXT legacy plaintext session migrated to encrypted format");
  } catch (err) {
    console.error("[security] JWXT session migration failed code=SESSION_MIGRATION_FAILED");
  }
  return stored;
}

function deleteCookies(userId) {
  const file = cookieFile(userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log("[session] jwxt delete scope=" + (userId ? "user" : "legacy"));
}

module.exports = {
  JWXT_PURPOSE,
  cookieFile,
  loadCookies,
  writeCookies,
  deleteCookies
};
