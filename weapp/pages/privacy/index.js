const PRIVACY_ACCEPTED_KEY = "privacyAccepted";

Page({
  data: {
    accepted: false
  },

  onShow() {
    this.setData({ accepted: Boolean(wx.getStorageSync(PRIVACY_ACCEPTED_KEY)) });
  },

  openOfficialPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: "请先在公众平台配置隐私保护指引", icon: "none" })
      });
      return;
    }
    wx.showToast({ title: "当前微信版本暂不支持打开平台指引", icon: "none" });
  },

  withdrawConsent() {
    wx.showModal({
      title: "撤回隐私同意",
      content: "撤回后将清除本地登录状态；云端数据可在“我的”页面单独删除。",
      confirmText: "确认撤回",
      success: result => {
        if (!result.confirm) return;
        wx.removeStorageSync(PRIVACY_ACCEPTED_KEY);
        wx.removeStorageSync("token");
        wx.setStorageSync("manualLogout", true);
        wx.removeStorageSync("userInfo");
        wx.removeStorageSync("jwxtBound");
        wx.removeStorageSync("jwxtBoundHint");
        this.setData({ accepted: false });
        wx.showToast({ title: "已撤回", icon: "none" });
      }
    });
  }
});
