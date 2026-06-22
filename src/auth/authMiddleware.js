const tokenStore = require("./tokenStore");

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);

  if (match) {
    const token = match[1];
    const userId = tokenStore.getUserId(token);
    console.log("[auth] middleware token=" + token.slice(0, 8) + " userId=" + (userId || "(none)"));
    if (userId) {
      req.userId = userId;
      console.log("[auth] userId=" + userId + " " + req.method + " " + req.path);
    }
  }

  next();
}

module.exports = {
  optionalAuth
};
