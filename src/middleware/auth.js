const { verifyToken } = require("../utils/jwt");

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "Missing authorization token" });
  }

  try {
    const payload = verifyToken(match[1]);
    req.user = payload;
    req.userId = payload.userId || payload.id;
    if (!req.userId) {
      return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "Invalid authorization token" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "Invalid authorization token" });
  }
}

module.exports = auth;
