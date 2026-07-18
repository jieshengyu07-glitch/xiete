const { verifyToken } = require("../utils/jwt");
const { isUserDataDeletionPending } = require("../services/userDataDeletion");

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
    if (isUserDataDeletionPending(req.userId)) {
      return res.status(423).json({
        success: false,
        error: "DATA_DELETION_IN_PROGRESS",
        message: "Personal data deletion is in progress"
      });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "UNAUTHORIZED", message: "Invalid authorization token" });
  }
}

module.exports = auth;
