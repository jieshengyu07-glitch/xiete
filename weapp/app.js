const { getApiBase, getApiEnv } = require("./config");

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
    apiBase: getApiBase(),
    apiEnv: getApiEnv(),
    clientVersion: "0.1.4-jwt",
    loginPromise: null,
    loginPromiseEpoch: null,
    lastLoginError: "",
    authEpoch: 0
  },

  onLaunch() {
    // Start the TLS connection and wake the API while the first page renders.
    // This request is best-effort and never blocks normal mini-program startup.
    wx.request({
      url: this.globalData.apiBase + "/health",
      method: "GET",
      timeout: 8000,
      success: () => {},
      fail: () => {}
    });
  },

  bumpAuthEpoch() {
    this.globalData.authEpoch = Number(this.globalData.authEpoch || 0) + 1;
    this.globalData.loginPromise = null;
    this.globalData.loginPromiseEpoch = null;
    return this.globalData.authEpoch;
  },

  invalidateAuth() {
    wx.removeStorageSync("token");
    return this.bumpAuthEpoch();
  },

  loginWithWechat(force) {
    // A forced refresh must still share an in-flight wx.login exchange. When
    // several requests receive 401 together, starting multiple exchanges can
    // race and overwrite a newer token with an older response.
    const requestEpoch = Number(this.globalData.authEpoch || 0);
    if (this.globalData.loginPromise && this.globalData.loginPromiseEpoch === requestEpoch) {
      return this.globalData.loginPromise;
    }

    const loginPromise = new Promise((resolve, reject) => {
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
              if (Number(this.globalData.authEpoch || 0) !== requestEpoch) {
                const stale = new Error("STALE_AUTH_REQUEST");
                stale.code = "STALE_AUTH_REQUEST";
                reject(stale);
                return;
              }
              const token = pickToken(res.data || {});
              if (token) {
                this.globalData.lastLoginError = "";
                wx.setStorageSync("token", token);
                wx.removeStorageSync("manualLogout");
                this.globalData.authEpoch = requestEpoch + 1;
                resolve(token);
                return;
              }
              this.globalData.lastLoginError = requestErrorText("微信登录失败", res);
              wx.removeStorageSync("token");
              reject(new Error(this.globalData.lastLoginError || "wechat login failed"));
            },
            fail: err => {
              if (Number(this.globalData.authEpoch || 0) !== requestEpoch) {
                const stale = new Error("STALE_AUTH_REQUEST");
                stale.code = "STALE_AUTH_REQUEST";
                reject(stale);
                return;
              }
              this.globalData.lastLoginError = requestErrorText("微信登录请求失败", err);
              wx.removeStorageSync("token");
              reject(err);
            }
          });
        },
        fail: err => {
          if (Number(this.globalData.authEpoch || 0) !== requestEpoch) {
            const stale = new Error("STALE_AUTH_REQUEST");
            stale.code = "STALE_AUTH_REQUEST";
            reject(stale);
            return;
          }
          this.globalData.lastLoginError = requestErrorText("wx.login 失败", err);
          wx.removeStorageSync("token");
          reject(err);
        }
      });
    }).then(
      value => {
        if (this.globalData.loginPromise === loginPromise) {
          this.globalData.loginPromise = null;
          this.globalData.loginPromiseEpoch = null;
        }
        return value;
      },
      err => {
        if (this.globalData.loginPromise === loginPromise) {
          this.globalData.loginPromise = null;
          this.globalData.loginPromiseEpoch = null;
        }
        throw err;
      }
    );

    this.globalData.loginPromise = loginPromise;
    this.globalData.loginPromiseEpoch = requestEpoch;
    return loginPromise;
  }
});
