function itemMatchesTerm(item, term) {
  if (!item || !term) return false;
  const year = item.termYear !== undefined ? item.termYear : item.term_year;
  const semester = item.termSemester !== undefined ? item.termSemester : item.term_semester;
  return String(year) === String(term.termYear) && String(semester) === String(term.termSemester);
}

function rowsForTerm(rows, term) {
  return (Array.isArray(rows) ? rows : []).filter(item => itemMatchesTerm(item, term));
}

function replaceTermRows(existingRows, term, replacementRows) {
  const preserved = (Array.isArray(existingRows) ? existingRows : [])
    .filter(item => !itemMatchesTerm(item, term));
  return preserved.concat(Array.isArray(replacementRows) ? replacementRows : []);
}

function shouldScheduleAutomaticSync(options) {
  const input = options || {};
  if (!input.userId || !input.hasCredentials) return false;
  if (Array.isArray(input.currentTermRows) && input.currentTermRows.length > 0) return false;

  const state = input.syncState || {};
  const lastFinishedAt = state.finishedAt || state.lastAttemptAt;
  const finishedAtMs = lastFinishedAt ? new Date(lastFinishedAt).getTime() : 0;
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const failedRetryIntervalMs = Number(input.failedRetryIntervalMs) || 0;
  if (state.status === "failed" && Number.isFinite(finishedAtMs) && finishedAtMs > 0 && now - finishedAtMs < failedRetryIntervalMs) {
    return false;
  }
  return true;
}

module.exports = {
  itemMatchesTerm,
  rowsForTerm,
  replaceTermRows,
  shouldScheduleAutomaticSync
};
