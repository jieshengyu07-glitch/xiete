App({
  globalData: {
    apiBase: "http://192.168.1.14:3456",
    token: ""
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync("authToken") || "";
    this.loginWithWechat();
  },

  loginWithWechat() {
    wx.login({
      success: loginRes => {
        if (!loginRes.code) return;
        wx.request({
          url: this.globalData.apiBase + "/auth/wechat-login",
          method: "POST",
          data: { code: loginRes.code },
          timeout: 10000,
          success: res => {
            const data = res.data || {};
            if (data.success && data.token) {
              this.globalData.token = data.token;
              wx.setStorageSync("authToken", data.token);
            }
          }
        });
      }
    });
  }
});
