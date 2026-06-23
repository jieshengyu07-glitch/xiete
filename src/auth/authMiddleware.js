const tokenStore = require("./tokenStore");

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);

  if (match) {
    const token = match[1];
    const userId = tokenStore.getUserId(token);
    if (userId) {
      req.userId = userId;
      console.log("[auth] authenticated " + req.method + " " + req.path);
    } else {
      console.log("[auth] invalid token " + req.method + " " + req.path);
    }
  }

  next();
}

module.exports = {
  optionalAuth
};
