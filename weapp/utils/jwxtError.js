const MESSAGE_BY_CODE = {
  JWXT_INVALID_CREDENTIALS: "学号或教务密码错误，请检查后重试",
  JWXT_CAPTCHA_REQUIRED: "教务系统需要验证码，请输入验证码完成验证",
  JWXT_CAPTCHA_INVALID: "验证码错误，请重新输入或刷新验证码",
  JWXT_CAPTCHA_SESSION_EXPIRED: "验证码已过期，请重新获取",
  JWXT_SSO_FAILED: "教务系统登录态获取失败，请先到官网登录完成验证后再回到小程序重试；如果仍失败，请确认你能在官网登录并进入教务系统",
  JWXT_TIMEOUT: "教务系统响应超时，请稍后再试",
  JWXT_UNAVAILABLE: "教务系统暂时不可用，请稍后再试",
  LOGIN_REQUIRED: "请先绑定教务账号"
};

function rawText(err, fallback) {
  if (!err) return fallback || "";
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

function lowerText(err, message) {
  return String(message || rawText(err)).toLowerCase();
}

function isInvalidCredentials(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  const original = String(message || rawText(err));
  return code === "JWXT_INVALID_CREDENTIALS" ||
    code === "INVALID_CREDENTIALS" ||
    code === "invalid_credentials" ||
    original.includes("密码错误") ||
    original.includes("用户名或密码") ||
    original.includes("账号或密码") ||
    original.includes("账户或密码") ||
    original.includes("认证失败") ||
    text.includes("invalid credentials") ||
    text.includes("invalid password") ||
    text.includes("password error") ||
    text.includes("wrong password");
}

function isCaptchaRequired(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  const original = String(message || rawText(err));
  return code === "JWXT_CAPTCHA_REQUIRED" ||
    code === "captcha_required" ||
    original.includes("验证码") ||
    text.includes("captcha") ||
    text.includes("verify code") ||
    text.includes("validatecode");
}

function isCaptchaWrong(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  const original = String(message || rawText(err));
  return code === "JWXT_CAPTCHA_INVALID" ||
    code === "CAPTCHA_LOGIN_FAILED" ||
    code === "CAPTCHA_WRONG" ||
    original.includes("验证码错误") ||
    text.includes("wrong captcha") ||
    text.includes("invalid captcha");
}

function isCaptchaSessionExpired(err, message) {
  const code = errorCode(err);
  const original = String(message || rawText(err));
  return code === "JWXT_CAPTCHA_SESSION_EXPIRED" ||
    code === "CAPTCHA_SESSION_EXPIRED" ||
    original.includes("验证码已过期");
}

function isSsoFailed(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  return code === "JWXT_SSO_FAILED" ||
    text.includes("jsessionid was not found") ||
    text.includes("no jsessionid") ||
    text.includes("jwxt jsessionid") ||
    text.includes("after sso redirects");
}

function isLoginRequired(err, message) {
  const code = errorCode(err);
  const original = String(message || rawText(err));
  return code === "LOGIN_REQUIRED" ||
    code === "login_required" ||
    original.includes("请先绑定");
}

function isTimeout(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  return code === "JWXT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    text.includes("timeout") ||
    text.includes("timed out");
}

function isUnavailable(err, message) {
  const code = errorCode(err);
  const text = lowerText(err, message);
  const original = String(message || rawText(err));
  return code === "JWXT_UNAVAILABLE" ||
    code === "jwxt_unavailable" ||
    text.includes("econn") ||
    text.includes("network") ||
    text.includes("socket hang up") ||
    text.includes("500") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504") ||
    original.includes("暂时不可用");
}

function formatJwxtErrorMessage(err, fallback) {
  const code = errorCode(err);
  const message = rawText(err, fallback);
  if (MESSAGE_BY_CODE[code]) return MESSAGE_BY_CODE[code];
  if (isInvalidCredentials(err, message)) return MESSAGE_BY_CODE.JWXT_INVALID_CREDENTIALS;
  if (isCaptchaSessionExpired(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_SESSION_EXPIRED;
  if (isCaptchaWrong(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_INVALID;
  if (isCaptchaRequired(err, message)) return MESSAGE_BY_CODE.JWXT_CAPTCHA_REQUIRED;
  if (isSsoFailed(err, message)) return MESSAGE_BY_CODE.JWXT_SSO_FAILED;
  if (isTimeout(err, message)) return MESSAGE_BY_CODE.JWXT_TIMEOUT;
  if (isLoginRequired(err, message)) return MESSAGE_BY_CODE.LOGIN_REQUIRED;
  if (isUnavailable(err, message)) return MESSAGE_BY_CODE.JWXT_UNAVAILABLE;
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
