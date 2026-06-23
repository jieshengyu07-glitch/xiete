function messageOf(err) {
  return String((err && err.message) || err || "");
}

function isNetworkOrTimeout(err, message) {
  const code = String((err && err.code) || "");
  const status = err && err.response && err.response.status;
  const text = String(message || "").toLowerCase();

  if (status >= 500) return true;
  if ([
    "ECONNABORTED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNRESET",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ENETUNREACH",
    "ERR_BAD_RESPONSE"
  ].includes(code)) return true;

  return text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("network") ||
    text.includes("socket hang up") ||
    text.includes("enotfound") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("econnaborted") ||
    text.includes("eai_again") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("500") ||
    text.includes("504");
}

function classifyJwxtLoginError(err) {
  const message = messageOf(err);
  const lower = message.toLowerCase();

  if (lower.includes("captcha") || message.includes("验证码") || message.includes("风控")) {
    return {
      error: "JWXT_CAPTCHA_REQUIRED",
      reason: "JWXT_CAPTCHA_REQUIRED",
      message: "教务系统需要验证码验证，请在小程序内完成一次验证。"
    };
  }

  if (
    lower.includes("invalid credentials") ||
    lower.includes("invalid username") ||
    lower.includes("wrong password") ||
    message.includes("用户名或密码") ||
    message.includes("账号或密码") ||
    message.includes("账户或密码") ||
    message.includes("密码错误") ||
    message.includes("用户名不存在") ||
    message.includes("认证失败")
  ) {
    return {
      error: "invalid_credentials",
      reason: "invalid_credentials",
      message: "账号或密码错误"
    };
  }

  if (
    isNetworkOrTimeout(err, message) ||
    message.includes("Missing execution") ||
    message.includes("Missing login-croypto") ||
    message.includes("JWXT JSESSIONID was not found")
  ) {
    return {
      error: "jwxt_unavailable",
      reason: "jwxt_unavailable",
      message: "账号已保存，教务系统暂时不可用，稍后可再检查成绩"
    };
  }

  return {
    error: "jwxt_unavailable",
    reason: "jwxt_unavailable",
    message: "账号已保存，教务系统暂时不可用，稍后可再检查成绩"
  };
}

module.exports = {
  classifyJwxtLoginError
};
