const ERROR_MESSAGES = {
  JWXT_INVALID_CREDENTIALS: "学号或教务密码错误，请检查后重试",
  JWXT_CAPTCHA_INVALID: "验证码错误，请重新输入或刷新验证码",
  JWXT_CAPTCHA_REQUIRED: "教务系统需要验证码，请输入验证码完成验证",
  JWXT_CAPTCHA_SESSION_EXPIRED: "验证码已过期，请重新获取",
  JWXT_SSO_FAILED: "教务系统登录态获取失败，请稍后重试；如果一直失败，请确认你能在官网登录并进入教务系统",
  JWXT_TIMEOUT: "教务系统响应超时，请稍后再试",
  JWXT_UNAVAILABLE: "教务系统暂时不可用，请稍后再试",
  JWXT_LOGIN_FAILED: "教务登录失败，请稍后再试",
  LOGIN_REQUIRED: "请先绑定教务账号"
};

function textFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || "";
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value || "");
  }
}

function messageOf(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return [
    err.message,
    err.errMsg,
    err.error,
    err.code,
    err.reason,
    err.finalUrl,
    err.response && err.response.data,
    err.data
  ].map(textFromValue).filter(Boolean).join(" ");
}

function codeOf(err, context) {
  return String(
    (context && (context.code || context.error || context.reason)) ||
    (err && (err.code || err.error || err.reason)) ||
    ""
  );
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function includesAny(text, patterns) {
  return patterns.some(pattern => text.includes(pattern));
}

function isHttpServerError(err, context) {
  const status = Number(
    (context && (context.status || context.httpStatus)) ||
    (err && (err.status || err.httpStatus)) ||
    (err && err.response && err.response.status) ||
    0
  );
  return status >= 500;
}

function normalizeJwxtLoginError(rawText, context) {
  const originalCode = codeOf(rawText, context);
  const text = normalizeText(messageOf(rawText) || textFromValue(rawText));
  const lower = text.toLowerCase();
  const codeLower = originalCode.toLowerCase();

  if (
    originalCode === "LOGIN_REQUIRED" ||
    codeLower === "login_required" ||
    lower.includes("login_required") ||
    text.includes("请先绑定")
  ) {
    return normalizeJwxtError("LOGIN_REQUIRED");
  }

  // 1. Account/password errors must win even if the same login page also contains captcha markup.
  if (
    originalCode === "JWXT_INVALID_CREDENTIALS" ||
    originalCode === "INVALID_CREDENTIALS" ||
    codeLower === "invalid_credentials" ||
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
    ])
  ) {
    return normalizeJwxtError("JWXT_INVALID_CREDENTIALS");
  }

  // 2. Captcha was submitted, but the submitted value was wrong/expired.
  if (
    originalCode === "JWXT_CAPTCHA_INVALID" ||
    originalCode === "CAPTCHA_LOGIN_FAILED" ||
    originalCode === "CAPTCHA_WRONG" ||
    codeLower === "captcha_invalid" ||
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
    ])
  ) {
    return normalizeJwxtError("JWXT_CAPTCHA_INVALID");
  }

  if (
    originalCode === "JWXT_CAPTCHA_SESSION_EXPIRED" ||
    originalCode === "CAPTCHA_SESSION_EXPIRED" ||
    codeLower === "captcha_session_expired" ||
    text.includes("验证码已过期")
  ) {
    return normalizeJwxtError("JWXT_CAPTCHA_SESSION_EXPIRED");
  }

  // 3. Captcha required only on explicit "required/empty/please enter" semantics.
  if (
    originalCode === "JWXT_CAPTCHA_REQUIRED" ||
    codeLower === "captcha_required" ||
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
    ])
  ) {
    return normalizeJwxtError("JWXT_CAPTCHA_REQUIRED");
  }

  // 4. SSO/JWXT session handoff failed after CAS.
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

  // 5. Timeout.
  if (
    originalCode === "JWXT_TIMEOUT" ||
    ["ECONNABORTED", "ETIMEDOUT"].includes(originalCode) ||
    includesAny(lower, [
      "timeout",
      "timed out",
      "etimedout"
    ])
  ) {
    return normalizeJwxtError("JWXT_TIMEOUT");
  }

  // 6. Network/server unavailable.
  if (
    originalCode === "JWXT_UNAVAILABLE" ||
    isHttpServerError(rawText, context) ||
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

  // 7. Known but nonspecific login failure, or final fallback.
  if (originalCode === "JWXT_LOGIN_FAILED" || codeLower === "jwxt_login_failed") {
    return normalizeJwxtError("JWXT_LOGIN_FAILED");
  }

  return normalizeJwxtError("JWXT_LOGIN_FAILED");
}

function classifyJwxtLoginError(err, context) {
  return normalizeJwxtLoginError(err, context);
}

function normalizeJwxtError(code, message) {
  const normalized = ERROR_MESSAGES[code] ? code : "JWXT_LOGIN_FAILED";
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
  normalizeJwxtLoginError,
  normalizeJwxtError,
  createJwxtError
};
