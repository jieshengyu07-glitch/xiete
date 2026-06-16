const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");
const config = require("../config");

class CasLogin {
  constructor() {
    this.cookieJar = new CookieJar();
    this.client = wrapper(axios.create({
      jar: this.cookieJar,
      withCredentials: true,
      maxRedirects: 20,  // 允许自动跟随重定向
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    }));
  }

  async _getLoginPage() {
    console.log("[登录] 获取CAS登录页面...");
    const resp = await this.client.get(config.urls.cas.loginPage);
    const $ = cheerio.load(resp.data);
    const execution = $("#login-page-flowkey").text().trim();
    if (!execution) throw new Error("无法获取 execution 令牌");
    const croyptoKey = $("p#login-croypto").text().trim();
    if (!croyptoKey) throw new Error("无法获取加密密钥");
    console.log("[登录] ✅ 已获取 execution 令牌和加密密钥");
    return { execution, croyptoKey };
  }

  _encryptPassword(key, password) {
    const keyHex = CryptoJS.enc.Base64.parse(key);
    return CryptoJS.DES.encrypt(password, keyHex, {
      mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7,
    }).toString();
  }

  async _submitLogin({ execution, croyptoKey }) {
    console.log("[登录] 提交登录...");
    const url = config.urls.cas.loginPage;
    const encrypted = this._encryptPassword(croyptoKey, config.password);

    // 构建原始编码的 form body（保留 + / = 号）
    const e = (s) => encodeURIComponent(s).replace(/%2B/g, "+").replace(/%2F/g, "/").replace(/%3D/g, "=");
    const rawBody = `username=${config.username}&password=${e(encrypted)}&type=UsernamePassword&_eventId=submit&geolocation=&execution=${e(execution)}`;

    try {
      const resp = await this.client.post(url, rawBody, {
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://sso1.tyust.edu.cn", "Referer": url, "X-Requested-With": "XMLHttpRequest" },
        maxRedirects: 0,  // 仅本次禁用重定向来获取 302
        validateStatus: s => true,
      });
      if (resp.status === 302 && resp.headers.location) {
        console.log("[登录] ✅ 登录成功 (302重定向)");
        return resp.headers.location;
      }
      if (resp.status === 200 && typeof resp.data === "string") {
        const m = resp.data.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (m) { console.log("[登录] ✅ 登录成功 (JS重定向)"); return m[1]; }
      }
      throw new Error(`登录失败，状态码: ${resp.status}`);
    } catch (err) {
      if (err.response?.status === 302 && err.response?.headers?.location) {
        console.log("[登录] ✅ 登录成功 (302异常捕获)");
        return err.response.headers.location;
      }
      throw err;
    }
  }

  async _completeSSO(startUrl) {
    console.log("[登录] 完成SSO认证链...");
    // 让 axios 自动跟随重定向来完成 SSO
    // CAS -> OAuth2 callback -> 融合门户 -> 教务系统
    let current = startUrl;
    try {
      const resp = await this.client.get(current, { maxRedirects: 20, validateStatus: s => true });
      current = resp.request?.res?.responseUrl || current;
    } catch(e) {
      if (e.response) current = e.response.headers?.location || current;
    }
    
    // 最终尝试直接访问教务系统
    try {
      const jwxtUrl = config.urls.jwxt.base + "/xtgl/index_initMenu.html?jsdm=xs&_t=" + Date.now();
      const jwxtResp = await this.client.get(jwxtUrl, { maxRedirects: 20, validateStatus: s => true });
      const fu = jwxtResp.request?.res?.responseUrl || jwxtUrl;
      if (fu.includes("index_initMenu") || (typeof jwxtResp.data === "string" && jwxtResp.data.includes("解圣宇"))) {
        console.log("[登录] ✅ 已到达教务系统");
      } else {
        console.log(`[登录] 到达: ${fu.substring(0, 80)}...`);
        // 再试一次
        const retry = await this.client.get(jwxtUrl, { maxRedirects: 20, validateStatus: s => true });
        const fu2 = retry.request?.res?.responseUrl || jwxtUrl;
        console.log(`[登录] 重试后: ${fu2.substring(0, 80)}...`);
      }
    } catch(e) {
      console.log("[登录] SSO异常:", e.message.substring(0, 80));
    }
  }

  async login() {
    try {
      const { execution, croyptoKey } = await this._getLoginPage();
      const redirectUrl = await this._submitLogin({ execution, croyptoKey });
      await this._completeSSO(redirectUrl);
      console.log("[登录] ✅ 登录流程完成");
      return this.cookieJar;
    } catch (err) {
      console.error("[登录] ❌ 登录失败:", err.message);
      throw err;
    }
  }
  getClient() { return this.client; }
}

module.exports = CasLogin;
