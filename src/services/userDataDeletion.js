const pendingUsers = new Set();

function normalizeUserId(userId) {
  return String(userId || "").trim();
}

function beginUserDataDeletion(userId) {
  const key = normalizeUserId(userId);
  if (!key || pendingUsers.has(key)) return false;
  pendingUsers.add(key);
  return true;
}

function finishUserDataDeletion(userId) {
  const key = normalizeUserId(userId);
  if (key) pendingUsers.delete(key);
}

function isUserDataDeletionPending(userId) {
  const key = normalizeUserId(userId);
  return Boolean(key && pendingUsers.has(key));
}

function assertUserDataWritable(userId) {
  if (!isUserDataDeletionPending(userId)) return;
  const err = new Error("DATA_DELETION_IN_PROGRESS");
  err.code = "DATA_DELETION_IN_PROGRESS";
  throw err;
}

module.exports = {
  beginUserDataDeletion,
  finishUserDataDeletion,
  isUserDataDeletionPending,
  assertUserDataWritable
};
