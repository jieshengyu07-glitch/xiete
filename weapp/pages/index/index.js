Page({
  data: {
    loggedIn: false
  },

  onShow() {
    this.setData({ loggedIn: Boolean(wx.getStorageSync("token")) });
  },

  continueToService() {
    if (this.data.loggedIn) {
      wx.switchTab({ url: "/pages/timetable/timetable" });
      return;
    }
    wx.navigateTo({ url: "/pages/login/index" });
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: "/pages/privacy/index" }) });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
  }
});
