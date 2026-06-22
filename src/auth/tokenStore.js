const crypto = require("crypto");

const tokens = new Map();

function createToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    userId,
    createdAt: new Date().toISOString()
  });
  return token;
}

function getUserId(token) {
  const item = tokens.get(token);
  return item ? item.userId : null;
}

module.exports = {
  createToken,
  getUserId
};
