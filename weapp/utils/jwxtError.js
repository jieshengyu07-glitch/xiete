function rawText(err, fallback) {
  if (!err) return fallback || "";
  return String(
    err.message ||
    err.errMsg ||
    err.error ||
    (err.data && (err.data.message || err.data.error)) ||
    fallback ||
    ""
  );
}

function errorCode(err) {
  return String((err && (err.error || err.code || (err.data && err.data.error))) || "");
}

function isInvalidCredentials(err, message) {
  const code = errorCode(err);
  const text = String(message || rawText(err)).toLowerCase();
  return code === "JWXT_INVALID_CREDENTIALS" ||
    code === "INVALID_CREDENTIALS" ||
    code === "invalid_credentials" ||
    text.includes("密码错误") ||
    text.includes("用户名或密码") ||
    text.includes("账号或密码") ||
    text.includes("认证失败") ||
    text.includes("invalid credentials") ||
    text.includes("invalid password");
}

function isCaptchaRequired(err, message) {
  const code = errorCode(err);
  const text = String(message || rawText(err));
  return code === "JWXT_CAPTCHA_REQUIRED" ||
    code === "captcha_required" ||
    text.includes("需要验证码");
}

function isCaptchaWrong(err, message) {
  const code = errorCode(err);
  const text = String(message || rawText(err)).toLowerCase();
  return code === "CAPTCHA_LOGIN_FAILED" ||
    code === "CAPTCHA_WRONG" ||
    text.includes("验证码错误") ||
    text.includes("wrong captcha") ||
    text.includes("invalid captcha");
}

function isLoginRequired(err, message) {
  const code = errorCode(err);
  const text = String(message || rawText(err));
  return code === "LOGIN_REQUIRED" ||
    code === "login_required" ||
    text.includes("先绑定");
}

function isUnavailable(err, message) {
  const code = errorCode(err);
  const text = String(message || rawText(err)).toLowerCase();
  return code === "JWXT_UNAVAILABLE" ||
    code === "jwxt_unavailable" ||
    code === "JWXT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econn") ||
    text.includes("network") ||
    text.includes("5xx") ||
    text.includes("500") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("暂时不可用");
}

function formatJwxtErrorMessage(err, fallback) {
  const message = rawText(err, fallback);
  if (isInvalidCredentials(err, message)) return "学号或教务密码错误，请检查后重试";
  if (isCaptchaRequired(err, message)) return "教务系统需要验证码，请输入验证码完成绑定";
  if (isCaptchaWrong(err, message)) return "验证码错误，请重新输入或刷新验证码";
  if (isLoginRequired(err, message)) return "请先绑定教务账号";
  if (isUnavailable(err, message)) return "教务系统暂时不可用，请稍后再试";
  return message || fallback || "请求失败，请稍后再试";
}

module.exports = {
  formatJwxtErrorMessage,
  isCaptchaRequired,
  isInvalidCredentials,
  isLoginRequired
};
