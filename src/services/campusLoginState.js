const credentialRuntime = require("./credentialRuntime");
const userPersistence = require("./userPersistence");

async function markCampusLoginValid(userId, source) {
  if (!userId) return false;
  const at = new Date().toISOString();
  const channel = String(source || "query").toLowerCase() === "xg" ? "xg" : "jwxt";
  const extra = { lastSuccessfulSyncAt: at };
  if (channel === "xg") {
    extra.xgStatus = "OK";
    extra.lastXgSuccessfulAt = at;
  } else {
    extra.lastJwxtError = null;
    extra.lastJwxtErrorMessage = null;
  }
  const updated = await credentialRuntime.updateBoundAccountStatus(userId, channel === "jwxt" ? "OK" : null, extra);
  userPersistence.updateSyncState(userId, {
    status: "ready",
    type: "campus",
    finishedAt: at,
    lastSuccessfulAt: at,
    lastError: "",
    errorCode: "",
    source: String(source || "query"),
    channel
  }, "campus");
  return updated;
}

module.exports = { markCampusLoginValid };
