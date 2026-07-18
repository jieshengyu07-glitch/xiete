const app = getApp();
const PRIVACY_ACCEPTED_KEY = "privacyAccepted";

Page({
  data: {
    loggingIn: false,
    privacyAccepted: false,
    error: ""
  },

  onShow() {
    this.setData({ privacyAccepted: Boolean(wx.getStorageSync(PRIVACY_ACCEPTED_KEY)) });
  },

  onPrivacyChange(e) {
    const accepted = Boolean(e && e.detail && e.detail.value && e.detail.value.length);
    this.setData({ privacyAccepted: accepted });
    if (accepted) wx.setStorageSync(PRIVACY_ACCEPTED_KEY, true);
    else wx.removeStorageSync(PRIVACY_ACCEPTED_KEY);
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({
        fail: () => wx.navigateTo({ url: "/pages/privacy/index" })
      });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
  },

  login() {
    if (this.data.loggingIn) return;
    if (!this.data.privacyAccepted) {
      wx.showToast({ title: "请先阅读并同意隐私保护指引", icon: "none" });
      return;
    }
    if (!app || typeof app.loginWithWechat !== "function") {
      this.setData({ error: "当前版本暂不支持微信登录，请稍后再试。" });
      return;
    }

    wx.setStorageSync(PRIVACY_ACCEPTED_KEY, true);
    this.setData({ loggingIn: true, error: "" });
    app.loginWithWechat(true).then(() => {
      wx.setStorageSync("userInfo", { nickName: "校园助手用户" });
      wx.removeStorageSync("jwxtBound");
      wx.removeStorageSync("jwxtBoundHint");
      this.setData({ loggingIn: false });
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/timetable/timetable" });
      }, 500);
    }).catch(() => {
      this.setData({
        loggingIn: false,
        error: (app.globalData && app.globalData.lastLoginError) || "微信登录失败，请稍后重试。"
      });
      wx.showToast({ title: "登录失败", icon: "none" });
    });
  }
});
