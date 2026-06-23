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

App({
  globalData: {
    apiBase: API_BASES[API_ENV],
    clientVersion: "0.1.4-jwt",
    loginPromise: null
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
                wx.setStorageSync("token", token);
                resolve(token);
                return;
              }
              wx.removeStorageSync("token");
              reject(new Error("wechat login failed"));
            },
            fail: err => {
              wx.removeStorageSync("token");
              reject(err);
            }
          });
        },
        fail: err => {
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
