const axios = require("axios");
const { safeUserId } = require("./userPaths");

const WECHAT_CODE_TO_SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";
let developmentFallbackLogged = false;

function configMissingError() {
  const err = new Error("WECHAT_CONFIG_MISSING");
  err.code = "WECHAT_CONFIG_MISSING";
  return err;
}

function assertWechatConfig() {
  const appid = String(process.env.WECHAT_APPID || "").trim();
  const secret = String(process.env.WECHAT_SECRET || "").trim();

  if (appid && secret) {
    return { appid, secret, developmentFallback: false };
  }

  if (process.env.NODE_ENV === "development") {
    if (!developmentFallbackLogged) {
      console.warn("[wechat] development fallback enabled");
      developmentFallbackLogged = true;
    }
    return { appid: "", secret: "", developmentFallback: true };
  }

  throw configMissingError();
}

async function resolveWechatOpenid(code, httpGet) {
  const config = assertWechatConfig();
  const loginCode = String(code || "").trim();

  if (!loginCode) {
    throw new Error("Missing wx.login code");
  }

  if (config.developmentFallback) {
    const safeCode = safeUserId(loginCode);
    if (!safeCode) throw new Error("Invalid wx.login code");
    return "dev_" + safeCode;
  }

  const request = typeof httpGet === "function" ? httpGet : axios.get;
  const resp = await request(WECHAT_CODE_TO_SESSION_URL, {
    params: {
      appid: config.appid,
      secret: config.secret,
      js_code: loginCode,
      grant_type: "authorization_code"
    },
    timeout: 10000
  });

  const data = resp && resp.data ? resp.data : {};
  if (!data.openid) {
    throw new Error(data.errmsg || "Failed to resolve openid");
  }
  return data.openid;
}

module.exports = {
  assertWechatConfig,
  resolveWechatOpenid
};
