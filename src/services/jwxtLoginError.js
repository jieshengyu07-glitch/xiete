const ERROR_MESSAGES = {
  JWXT_INVALID_CREDENTIALS: "学号或教务密码错误，请检查后重试",
  JWXT_CAPTCHA_REQUIRED: "教务系统需要验证码，请输入验证码完成验证",
  JWXT_CAPTCHA_INVALID: "验证码错误，请重新输入或刷新验证码",
  JWXT_SSO_FAILED: "教务系统登录态获取失败，请尝试验证码绑定；如果仍失败，请确认你能在官网登录并进入教务系统",
  JWXT_TIMEOUT: "教务系统响应超时，请稍后再试",
  JWXT_UNAVAILABLE: "教务系统暂时不可用，请稍后再试",
  LOGIN_REQUIRED: "请先绑定教务账号"
};

function messageOf(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return String(
    err.message ||
    err.errMsg ||
    err.error ||
    err.code ||
    (err.response && err.response.data) ||
    ""
  );
}

function codeOf(err) {
  return String((err && (err.code || err.error || err.reason)) || "");
}

function includesAny(text, patterns) {
  return patterns.some(pattern => text.includes(pattern));
}

function isHttpServerError(err) {
  const status = Number((err && err.status) || (err && err.httpStatus) || (err && err.response && err.response.status) || 0);
  return status >= 500;
}

function classifyJwxtLoginError(err) {
  const originalCode = codeOf(err);
  const message = messageOf(err);
  const lower = message.toLowerCase();
  const codeLower = originalCode.toLowerCase();

  if (
    originalCode === "LOGIN_REQUIRED" ||
    codeLower === "login_required" ||
    lower.includes("login_required") ||
    message.includes("请先绑定")
  ) {
    return normalizeJwxtError("LOGIN_REQUIRED");
  }

  if (
    originalCode === "JWXT_INVALID_CREDENTIALS" ||
    originalCode === "INVALID_CREDENTIALS" ||
    codeLower === "invalid_credentials" ||
    includesAny(lower, [
      "invalid credentials",
      "invalid password",
      "password error",
      "wrong password"
    ]) ||
    includesAny(message, [
      "密码错误",
      "用户名或密码",
      "账号或密码",
      "账户或密码",
      "认证失败",
      "用户不存在",
      "学号或教务密码错误"
    ])
  ) {
    return normalizeJwxtError("JWXT_INVALID_CREDENTIALS");
  }

  if (
    originalCode === "JWXT_CAPTCHA_INVALID" ||
    originalCode === "CAPTCHA_LOGIN_FAILED" ||
    originalCode === "CAPTCHA_WRONG" ||
    codeLower === "captcha_invalid" ||
    includesAny(lower, [
      "wrong captcha",
      "invalid captcha",
      "captcha invalid"
    ]) ||
    includesAny(message, [
      "验证码错误",
      "验证码或登录信息错误"
    ])
  ) {
    return normalizeJwxtError("JWXT_CAPTCHA_INVALID");
  }

  if (
    originalCode === "JWXT_CAPTCHA_REQUIRED" ||
    codeLower === "captcha_required" ||
    includesAny(lower, [
      "captcha",
      "verify code",
      "validatecode"
    ]) ||
    includesAny(message, [
      "验证码",
      "风控"
    ])
  ) {
    return normalizeJwxtError("JWXT_CAPTCHA_REQUIRED");
  }

  if (
    originalCode === "JWXT_SSO_FAILED" ||
    includesAny(lower, [
      "jsessionid was not found",
      "no jsessionid",
      "jwxt jsessionid",
      "after sso redirects"
    ])
  ) {
    return normalizeJwxtError("JWXT_SSO_FAILED");
  }

  if (
    originalCode === "JWXT_TIMEOUT" ||
    ["ECONNABORTED", "ETIMEDOUT"].includes(originalCode) ||
    includesAny(lower, [
      "timeout",
      "timed out"
    ])
  ) {
    return normalizeJwxtError("JWXT_TIMEOUT");
  }

  if (
    originalCode === "JWXT_UNAVAILABLE" ||
    isHttpServerError(err) ||
    [
      "ENOTFOUND",
      "ECONNRESET",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ENETUNREACH",
      "ERR_BAD_RESPONSE"
    ].includes(originalCode) ||
    includesAny(lower, [
      "network",
      "socket hang up",
      "enotfound",
      "econnreset",
      "econnrefused",
      "econnaborted",
      "eai_again",
      "503",
      "502",
      "500",
      "504"
    ])
  ) {
    return normalizeJwxtError("JWXT_UNAVAILABLE");
  }

  return normalizeJwxtError("JWXT_UNAVAILABLE");
}

function normalizeJwxtError(code, message) {
  const normalized = ERROR_MESSAGES[code] ? code : "JWXT_UNAVAILABLE";
  return {
    error: normalized,
    reason: normalized,
    code: normalized,
    message: message || ERROR_MESSAGES[normalized]
  };
}

function createJwxtError(code, message) {
  const normalized = normalizeJwxtError(code, message);
  const err = new Error(normalized.message);
  err.code = normalized.code;
  err.error = normalized.error;
  return err;
}

module.exports = {
  ERROR_MESSAGES,
  classifyJwxtLoginError,
  normalizeJwxtError,
  createJwxtError
};
