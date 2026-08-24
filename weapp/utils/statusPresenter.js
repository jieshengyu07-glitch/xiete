function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function errorCode(value) {
  return normalizeCode(value && (value.error || value.code || value.warningCode || value.errorCode ||
    (value.data && (value.data.error || value.data.code))));
}

function formatSyncTime(value, nowValue) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = nowValue ? new Date(nowValue) : new Date();
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 60 * 1000) return "刚刚更新";
  if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前更新";
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const time = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return "今天 " + time + " 更新";
  return (date.getMonth() + 1) + " 月 " + date.getDate() + " 日 " + time + " 更新";
}

const RELOGIN_CODES = new Set([
  "ACCOUNT_RELOGIN_REQUIRED", "RELOGIN_REQUIRED", "SESSION_DECRYPT_FAILED",
  "COOKIE_EXPIRED", "LOGIN_FAILED", "JWXT_LOGIN_FAILED", "JWXT_SSO_FAILED"
]);
const CAPTCHA_CODES = new Set([
  "CAPTCHA_REQUIRED", "JWXT_CAPTCHA_REQUIRED", "PORTAL_VERIFICATION_REQUIRED"
]);
const SCHOOL_UNAVAILABLE_CODES = new Set([
  "JWXT_UNAVAILABLE", "JWXT_TIMEOUT", "PORTAL_UNAVAILABLE", "XG_SCORE_QUERY_FAILED",
  "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"
]);

function wechatPresentation(input) {
  const status = input || {};
  let state = normalizeCode(status.state);
  if (!state) {
    if (status.signingIn) state = "SIGNING_IN";
    else if (status.authExpired) state = "AUTH_EXPIRED";
    else if (status.error) state = "ERROR";
    else state = status.token ? "SIGNED_IN" : "SIGNED_OUT";
  }
  const map = {
    UNKNOWN: { level: "muted", title: "正在确认登录状态", actionText: "" },
    SIGNED_OUT: { level: "muted", title: "未登录", actionText: "微信登录" },
    SIGNING_IN: { level: "muted", title: "正在微信登录", actionText: "" },
    SIGNED_IN: { level: "ok", title: "已登录", actionText: "" },
    AUTH_EXPIRED: { level: "warn", title: "微信登录已失效", actionText: "重新登录" },
    ERROR: { level: "err", title: "暂时无法登录", actionText: "重试" }
  };
  return Object.assign({ state }, map[state] || map.UNKNOWN);
}

function campusPresentation(input, options) {
  const status = input || {};
  const productState = normalizeCode(status.account && status.account.state);
  const campusStatus = normalizeCode(status.campusLoginStatus);
  const jwxtStatus = normalizeCode(status.jwxtStatus);
  const cookieStatus = normalizeCode(status.cookieStatus);
  const code = errorCode(status) || normalizeCode(status.lastJwxtError);
  const bound = typeof status.bound === "boolean" ? status.bound : Boolean(status.account && status.account.bound);
  const binding = Boolean(options && options.binding);

  let state = productState;
  if (binding) state = "BINDING";
  else if (!bound) state = "UNBOUND";
  else if (productState && productState !== "BOUND") state = productState;
  else if (campusStatus === "VALID") state = "BOUND";
  else if (campusStatus === "RECOVERING" || status.sessionRecoveryPending) state = "RECOVERING";
  else if (CAPTCHA_CODES.has(code) || CAPTCHA_CODES.has(jwxtStatus) || CAPTCHA_CODES.has(cookieStatus)) state = "CAPTCHA_REQUIRED";
  else if (RELOGIN_CODES.has(code) || RELOGIN_CODES.has(campusStatus) || RELOGIN_CODES.has(jwxtStatus) || RELOGIN_CODES.has(cookieStatus)) state = "RELOGIN_REQUIRED";
  else if (SCHOOL_UNAVAILABLE_CODES.has(code) || SCHOOL_UNAVAILABLE_CODES.has(jwxtStatus) || SCHOOL_UNAVAILABLE_CODES.has(cookieStatus)) state = "SCHOOL_UNAVAILABLE";
  else if (!state) state = "BOUND";

  const presentations = {
    UNBOUND: { level: "muted", title: "还没有绑定校园账号", description: "绑定后可以同步课表和成绩。", actionText: "绑定校园账号" },
    BINDING: { level: "muted", title: "正在验证校园账号", description: "请稍候，不要重复提交。", actionText: "" },
    RECOVERING: { level: "muted", title: "正在恢复校园账号", description: "恢复期间仍可查看上次同步的数据。", actionText: "" },
    CAPTCHA_REQUIRED: { level: "warn", title: "学校系统需要验证码", description: "完成验证码后即可继续验证账号。", actionText: "完成验证" },
    RELOGIN_REQUIRED: { level: "warn", title: "校园账号需要重新验证", description: "登录状态已经失效，你的历史课表和成绩不会被删除。", actionText: "重新验证" },
    SCHOOL_UNAVAILABLE: { level: "warn", title: "学校系统暂时无法访问", description: "你仍然可以查看上次同步的数据。", actionText: "稍后重试" },
    BOUND: { level: "ok", title: "校园账号已绑定", description: "账号状态正常，可同步课表和成绩。", actionText: "管理校园账号" },
    ERROR: { level: "err", title: "校园账号状态异常", description: "请稍后重试。", actionText: "重试" }
  };
  return Object.assign({ state, bound }, presentations[state] || presentations.ERROR);
}

function dataPresentation(kind, input) {
  const data = input || {};
  const domain = data[kind] || {};
  const hasData = kind === "timetable"
    ? Boolean(data.hasTimetable || data.hasData || domain.hasData)
    : Boolean(data.hasGrades || data.hasData || domain.hasData || Number(data.count || data.totalGrades) > 0);
  const product = domain.state ? normalizeCode(domain.state) : "";
  const termStatus = normalizeCode(data.termStatus || domain.termStatus || data.status);
  const syncStatus = normalizeCode(data.syncStatus || (kind === "timetable" ? data.timetableSyncStatus : data.gradeQueryStatus));
  const failed = syncStatus === "FAILED" || Boolean(data.warning) || Boolean(data.errorCode);
  let state = product;

  if (kind === "timetable" && ["PRE_TERM", "VACATION", "BETWEEN_TERMS"].includes(termStatus)) state = termStatus;
  else if (data.syncing || syncStatus === "RUNNING" || syncStatus === "RECOVERING") state = "SYNCING";
  else if (failed) state = hasData ? "SYNC_FAILED_WITH_CACHE" : "SYNC_FAILED_NO_CACHE";
  else if (!state && !hasData) state = "NO_DATA";
  else if (!state && hasData && syncStatus === "SUCCESS") state = "READY";
  else if (!state && hasData) state = "CACHED";

  const name = kind === "timetable" ? "课表" : "成绩";
  const map = {
    PRE_TERM: { level: "muted", title: "新学期尚未开始", description: "课表将在新学期开始后显示。", actionText: "" },
    VACATION: { level: "muted", title: "当前处于假期", description: "历史课表仍会保留。", actionText: "" },
    BETWEEN_TERMS: { level: "muted", title: "当前处于学期间假期", description: "新学期课表将在开学后显示。", actionText: "" },
    NO_DATA: { level: "muted", title: "还没有同步" + name, description: "完成校园账号验证后即可同步。", actionText: "同步" + name },
    CACHED: { level: "muted", title: name + "已有缓存", description: "当前显示上次同步的数据。", actionText: "重新同步" },
    SYNCING: { level: "muted", title: "正在同步" + name, description: hasData ? "当前继续显示上次同步的数据。" : "请稍候。", actionText: "" },
    SYNC_FAILED_WITH_CACHE: { level: "warn", title: "暂时无法同步最新" + name, description: "当前显示的是上次同步的数据。", actionText: "重新同步" },
    SYNC_FAILED_NO_CACHE: { level: "err", title: "暂时无法同步" + name, description: "学校系统暂时无法访问，请稍后再试。", actionText: "重新同步" },
    READY: { level: "ok", title: name + "已更新", description: "", actionText: "" }
  };
  return Object.assign({ state, hasData }, map[state] || map.NO_DATA, {
    updatedAtText: formatSyncTime(data.updatedAt || domain.updatedAt || data.lastSuccessfulSyncAt)
  });
}

function timetablePresentation(input) {
  return dataPresentation("timetable", input);
}

function gradesPresentation(input) {
  return dataPresentation("grades", input);
}

function userErrorMessage(value, fallback) {
  const code = errorCode(value);
  if (code === "RATE_LIMITED") return "操作太频繁，请稍后再试";
  if (code === "SESSION_DECRYPT_FAILED") return "校园账号需要重新验证";
  if (SCHOOL_UNAVAILABLE_CODES.has(code)) return "学校系统暂时无法访问，请稍后再试";
  return fallback || "操作失败，请稍后再试";
}

module.exports = {
  normalizeCode,
  errorCode,
  formatSyncTime,
  wechatPresentation,
  campusPresentation,
  timetablePresentation,
  gradesPresentation,
  userErrorMessage
};
