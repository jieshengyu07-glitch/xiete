const app = getApp();

Page({
  data: {
    loggingIn: false,
    error: ""
  },

  login() {
    if (this.data.loggingIn) return;
    if (!app || typeof app.loginWithWechat !== "function") {
      this.setData({ error: "当前版本暂不支持微信登录，请稍后再试。" });
      return;
    }

    this.setData({ loggingIn: true, error: "" });
    app.loginWithWechat(true).then(() => {
      wx.setStorageSync("userInfo", { nickName: "科大同学" });
      wx.removeStorageSync("jwxtBound");
      wx.removeStorageSync("jwxtBoundHint");
      this.setData({ loggingIn: false });
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.switchTab({ url: "/pages/profile/index" });
        }
      }, 500);
    }).catch(() => {
      this.setData({
        loggingIn: false,
        error: (app.globalData && app.globalData.lastLoginError) || "微信登录失败，请稍后重试。"
      });
      wx.showToast({ title: "登录失败", icon: "none" });
    });
  },

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/settings" });
  }
});
