const crypto = require("crypto");

function canonicalUserId(userId) {
  return String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function userIdHash(userId) {
  const canonical = canonicalUserId(userId);
  if (!canonical) return "legacy";
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 10);
}

module.exports = {
  canonicalUserId,
  userIdHash
};
