const ERROR_MESSAGES = {
  JWXT_INVALID_CREDENTIALS: "学号或密码错误，请重新输入",
  JWXT_CAPTCHA_INVALID: "验证码错误，请重新输入或刷新验证码",
  JWXT_CAPTCHA_REQUIRED: "教务系统需要验证码，请输入验证码完成验证",
  JWXT_CAPTCHA_SESSION_EXPIRED: "验证码已过期，请重新获取",
  JWXT_SSO_FAILED: "教务系统登录态获取失败，请稍后重试；如果一直失败，请确认你能在官网登录并进入教务系统",
  JWXT_TIMEOUT: "教务系统响应超时，请稍后再试",
  JWXT_UNAVAILABLE: "学校官网叒崩了，一会再重试吧",
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

function errorChain(value) {
  const chain = [];
  let current = value;
  while (current && typeof current === "object" && chain.length < 6 && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function upstreamStatus(err, context) {
  const candidates = [context].concat(errorChain(err));
  for (const item of candidates) {
    const status = Number(
      item && ((item.response && item.response.status) || item.status || item.httpStatus)
    );
    if (Number.isFinite(status) && status > 0) return status;
  }
  return 0;
}

function upstreamCodes(err, context) {
  return [context].concat(errorChain(err)).flatMap(item => [
    item && item.code,
    item && item.error,
    item && item.reason
  ]).filter(Boolean).map(value => String(value).toUpperCase());
}

function upstreamText(err, context) {
  const chain = errorChain(err);
  const values = [context].concat(chain.length ? chain : [err]);
  return normalizeText(values.map(messageOf).filter(Boolean).join(" ")).toLowerCase();
}

function isJwxtUpstreamFailure(err, context) {
  const status = upstreamStatus(err, context);
  if (status >= 500) return true;

  const codes = upstreamCodes(err, context);
  if (codes.some(code => [
    "JWXT_UNAVAILABLE",
    "JWXT_TIMEOUT",
    "ETIMEDOUT",
    "ESOCKETTIMEDOUT",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EPIPE",
    "EPROTO",
    "ERR_NETWORK",
    "ERR_BAD_RESPONSE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED"
  ].includes(code))) return true;

  const chain = errorChain(err);
  if (chain.some(item => item && item.request && !item.response)) return true;
  if ([context].concat(chain).some(item => item && item.upstreamResponseEmpty === true)) return true;

  const lower = upstreamText(err, context);
  return includesAny(lower, [
    "socket hang up",
    "network error",
    "network timeout",
    "connect timeout",
    "connection timeout",
    "request timeout",
    "response timeout",
    "socket timeout",
    "dns failure",
    "tls connection failure",
    "connection aborted",
    "connection closed before response",
    "upstream unavailable",
    "service unavailable",
    "login page fetch failed",
    "empty upstream response",
    "no response from jwxt",
    "timed out",
    "timeout",
    "etimedout",
    "esockettimedout",
    "econnaborted",
    "econnrefused",
    "econnreset",
    "enotfound",
    "eai_again"
  ]);
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

  // 1. Transport/upstream evidence always wins over response-body heuristics.
  if (isJwxtUpstreamFailure(rawText, context)) {
    return normalizeJwxtError("JWXT_UNAVAILABLE");
  }

  // 2. Explicit account/password errors win over captcha markup in a valid response.
  if (
    originalCode === "JWXT_INVALID_CREDENTIALS" ||
    originalCode === "INVALID_CREDENTIALS" ||
    codeLower === "invalid_credentials" ||
    includesAny(lower, [
      "invalid credentials",
      "invalid password",
      "incorrect password",
      "password error",
      "user not found",
      "unknown user"
    ]) ||
    includesAny(text, [
      "密码错误",
      "密码不正确",
      "密码有误",
      "用户名或密码错误",
      "账号或密码错误",
      "账户或密码错误",
      "学号或密码错误",
      "用户名不存在",
      "账号不存在",
      "账户不存在",
      "学号不存在",
      "学号或教务密码错误"
    ])
  ) {
    return normalizeJwxtError("JWXT_INVALID_CREDENTIALS");
  }

  // 3. Captcha was submitted, but the submitted value was wrong/expired.
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

  // 4. Captcha required only on explicit "required/empty/please enter" semantics.
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

  // 5. SSO/JWXT session handoff failed after CAS.
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

  // 6. A returned login page or generic failure without explicit credential
  // evidence is not enough to claim that the account/password is wrong.
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
  isJwxtUpstreamFailure,
  normalizeJwxtLoginError,
  normalizeJwxtError,
  createJwxtError
};
