const API_ENV = "production";
const API_BASES = {
  production: "https://xiete.onrender.com",
  // 本地开发可切换为 development；也可改成 http://localhost:3456
  development: "http://192.168.1.14:3456"
};

function pickToken(data) {
  if (!data || typeof data !== "object") return "";
  return data.token ||
    (data.data && data.data.token) ||
    data.accessToken ||
    data.jwt ||
    "";
}

function requestErrorText(prefix, detail) {
  const parts = [prefix];
  if (detail && detail.statusCode) parts.push("HTTP " + detail.statusCode);
  if (detail && detail.errMsg) parts.push(detail.errMsg);
  if (detail && detail.data && detail.data.message) parts.push(detail.data.message);
  if (detail && detail.data && detail.data.error) parts.push(detail.data.error);
  return parts.filter(Boolean).join(": ");
}

App({
  globalData: {
    apiBase: API_BASES[API_ENV],
    clientVersion: "0.1.4-jwt",
    loginPromise: null,
    lastLoginError: ""
  },

  onLaunch() {
    this.loginWithWechat().catch(() => {});
  },

  loginWithWechat(force) {
    if (!force && this.globalData.loginPromise) return this.globalData.loginPromise;

    this.globalData.loginPromise = new Promise((resolve, reject) => {
      wx.login({
        success: loginRes => {
          if (!loginRes.code) {
            reject(new Error("wx.login did not return code"));
            return;
          }
          wx.request({
            url: this.globalData.apiBase + "/auth/wechat-login",
            method: "POST",
            header: { "Content-Type": "application/json" },
            data: { code: loginRes.code },
            timeout: 10000,
            success: res => {
              const token = pickToken(res.data || {});
              if (token) {
                this.globalData.lastLoginError = "";
                wx.setStorageSync("token", token);
                resolve(token);
                return;
              }
              this.globalData.lastLoginError = requestErrorText("微信登录失败", res);
              wx.removeStorageSync("token");
              reject(new Error(this.globalData.lastLoginError || "wechat login failed"));
            },
            fail: err => {
              this.globalData.lastLoginError = requestErrorText("微信登录请求失败", err);
              wx.removeStorageSync("token");
              reject(err);
            }
          });
        },
        fail: err => {
          this.globalData.lastLoginError = requestErrorText("wx.login 失败", err);
          wx.removeStorageSync("token");
          reject(err);
        }
      });
    }).then(
      value => {
        this.globalData.loginPromise = null;
        return value;
      },
      err => {
        this.globalData.loginPromise = null;
        throw err;
      }
    );

    return this.globalData.loginPromise;
  }
});
