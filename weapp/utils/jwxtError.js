const MESSAGE_BY_CODE = {
  JWXT_INVALID_CREDENTIALS: "学号或教务密码错误，请检查后重试",
  JWXT_CAPTCHA_INVALID: "验证码错误，请重新输入或刷新验证码",
  JWXT_CAPTCHA_REQUIRED: "教务系统需要验证码，请输入验证码完成验证",
  JWXT_CAPTCHA_SESSION_EXPIRED: "验证码已过期，请重新获取",
  JWXT_SSO_FAILED: "教务系统登录态获取失败，请先到官网登录完成验证后再回到小程序重试；如果仍失败，请确认你能在官网登录并进入教务系统",
  JWXT_TIMEOUT: "教务系统响应超时，请稍后再试",
  JWXT_UNAVAILABLE: "教务系统暂时不可用，请稍后再试",
  JWXT_LOGIN_FAILED: "教务登录失败，请稍后再试",
  LOGIN_REQUIRED: "请先绑定教务账号"
};

function rawText(err, fallback) {
  if (!err) return fallback || "";
  if (typeof err === "string") return err;
  return String(
    err.message ||
    err.errMsg ||
    err.error ||
    err.code ||
    (err.data && (err.data.message || err.data.error)) ||
    fallback ||
    ""
  );
}

function errorCode(err) {
  return String((err && (err.error || err.code || (err.data && err.data.error))) || "");
}

function includesAny(text, patterns) {
  return patterns.some(pattern => text.includes(pattern));
}

function normalizedText(err, message) {
  return String(message || rawText(err)).replace(/\s+/g, " ").trim();
}

function isInvalidCredentials(err, message) {
  const code = errorCode(err);
  const text = normalizedText(err, message);
  const lower = text.toLowerCase();
  return code === "JWXT_INVALID_CREDENTIALS" ||
    code === "INVALID_CREDENTIALS" ||
    code === "invalid_credentials" ||
    includesAny(lower, [
      "invalid credentials",
      "invalid password",
      "password error",
      "user not found"
    ]) ||
    includesAny(text, [
      "密码错误",
      "用户名或密码错误",
      "用户名或密码",
      "账号或密码错误",
      "账号或密码",
      "学号或密码错误",
      "用户名不存在",
      "账号不存在",
      "认证失败",
      "登录失败，用户名或密码",
      "学号或教务密码错误"
    ]);
}

function isCaptchaWrong(err, message) {
  const code = errorCode(err);
  const text = normalizedText(err, message);
  const lower = text.toLowerCase();
  return code === "JWXT_CAPTCHA_INVALID" ||
    code === "CAPTCHA_LOGIN_FAILED" ||
    code === "CAPTCHA_WRONG" ||
    includesAny(lower, [
      "captcha invalid",
      "invalid captcha",
      "verify code error"
    ]) ||
    includesAny(text, [
      "验证码错误",
      "验证码不正确",
      "验证码已失效",
      "验证码或登录信息错误"
    ]);
}

function isCaptchaSessionExpired(err, message) {
  const code = errorCode(err);
  const text = normalizedText(err, message);
  return code === "JWXT_CAPTCHA_SESSION_EXPIRED" ||
    code === "CAPTCHA_SESSION_EXPIRED" ||
    text.includes("验证码已过期");
}

function isCaptchaRequired(err, message) {
  if (isInvalidCredentials(err, message) || isCaptchaWrong(err, message) || isCaptchaSessionExpired(err, message)) return false;
  const code = errorCode(err);
  const text = normalizedText(err, message);
  const lower = text.toLowerCase();
  return code === "JWXT_CAPTCHA_REQUIRED" ||
    code === "captcha_required" ||
    includesAny(lower, [
      "captcha required",
      "verify code required",
      "validatecode required"
    ]) ||
    includesAny(text, [
      "请输入验证码",
      "验证码不能为空",
      "需要验证码",
      "请完成验证码"
    ]);
}

function isSsoFailed(err, message) {
  const code = errorCode(err);
  const lower = normalizedText(err, message).toLowerCase();
  return code === "JWXT_SSO_FAILED" ||
    lower.includes("jsessionid was not found") ||
    lower.includes("no jsessionid") ||
    lower.includes("jwxt jsessionid") ||
    lower.includes("after sso redirects");
}

function isLoginRequired(err, message) {
  const code = errorCode(err);
  const text = normalizedText(err, message);
  return code === "LOGIN_REQUIRED" ||
    code === "login_required" ||
    text.includes("请先绑定");
}

function isTimeout(err, message) {
  const code = errorCode(err);
  const lower = normalizedText(err, message).toLowerCase();
  return code === "JWXT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("etimedout");
}

function isUnavailable(err, message) {
  const code = errorCode(err);
  const lower = normalizedText(err, message).toLowerCase();
  const text = normalizedText(err, message);
  return code === "JWXT_UNAVAILABLE" ||
    code === "jwxt_unavailable" ||
    lower.includes("econn") ||
    lower.includes("network") ||
    lower.includes("socket hang up") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    text.includes("暂时不可用");
}

function formatJwxtErrorMessage(err, fallback) {
  const code = errorCode(err);
  const message = rawText(err, fallback);

  // Keep the same priority as the backend classifier. Text wins over a broad code.
  if (isInvalidCredentials(err, message)) return MESSAGE_BY_CODE.JWXT_INVALID_CREDENTIALS;
  if (isCaptchaWrong(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_INVALID;
  if (isCaptchaSessionExpired(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_SESSION_EXPIRED;
  if (isCaptchaRequired(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_REQUIRED;
  if (isSsoFailed(err, message)) return MESSAGE_BY_CODE.JWXT_SSO_FAILED;
  if (isTimeout(err, message)) return MESSAGE_BY_CODE.JWXT_TIMEOUT;
  if (isUnavailable(err, message)) return MESSAGE_BY_CODE.JWXT_UNAVAILABLE;
  if (isLoginRequired(err, message)) return MESSAGE_BY_CODE.LOGIN_REQUIRED;
  if (MESSAGE_BY_CODE[code]) return MESSAGE_BY_CODE[code];
  return message || fallback || "请求失败，请稍后重试";
}

module.exports = {
  formatJwxtErrorMessage,
  isCaptchaRequired,
  isInvalidCredentials,
  isLoginRequired,
  isCaptchaWrong,
  isCaptchaSessionExpired,
  isSsoFailed
};
