const app = getApp();

Page({
  data: {
    apiAddr: app.globalData.apiBase,
    version: "1.0.0",
    studentId: "",
    password: "",
    binding: false,
    unbinding: false
  },

  onStudentIdInput(e) {
    this.setData({ studentId: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  bindAccount() {
    const studentId = String(this.data.studentId || "").trim();
    const password = String(this.data.password || "");

    if (!studentId || !password) {
      wx.showToast({ title: "\u8bf7\u8f93\u5165\u5b66\u53f7\u548c\u5bc6\u7801", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    wx.showLoading({ title: "\u7ed1\u5b9a\u4e2d..." });

    wx.request({
      url: app.globalData.apiBase + "/bind-account",
      method: "POST",
      timeout: 120000,
      data: { studentId, password },
      success: res => {
        wx.hideLoading();
        const data = res.data || {};
        if (data.success) {
          this.setData({ password: "", binding: false });
          wx.showToast({ title: "\u7ed1\u5b9a\u6210\u529f", icon: "success" });
          wx.showModal({
            title: "\u7ed1\u5b9a\u6210\u529f",
            content: "\u7ed1\u5b9a\u6210\u529f\uff0c\u4e4b\u540e\u53ef\u81ea\u52a8\u67e5\u6210\u7ee9",
            showCancel: false
          });
        } else {
          this.setData({ binding: false });
          wx.showToast({ title: data.message || "\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ binding: false });
        wx.showToast({ title: "\u6559\u52a1\u7cfb\u7edf\u4e0d\u53ef\u7528", icon: "none" });
      }
    });
  },

  unbindAccount() {
    wx.showModal({
      title: "\u786e\u8ba4\u89e3\u9664\u7ed1\u5b9a",
      content: "\u89e3\u9664\u540e\u5c06\u5220\u9664\u672c\u5730\u7ed1\u5b9a\u8d26\u53f7\u548c Cookie\uff0c\u4e0d\u4f1a\u5220\u9664\u5df2\u5b58\u6210\u7ee9\u3002",
      confirmText: "\u89e3\u9664\u7ed1\u5b9a",
      confirmColor: "#e74c3c",
      success: result => {
        if (!result.confirm) return;
        this.doUnbindAccount();
      }
    });
  },

  doUnbindAccount() {
    this.setData({ unbinding: true });
    wx.showLoading({ title: "\u89e3\u9664\u4e2d..." });

    wx.request({
      url: app.globalData.apiBase + "/unbind-account",
      method: "POST",
      timeout: 30000,
      success: res => {
        wx.hideLoading();
        this.setData({ unbinding: false, password: "" });
        if (res.data && res.data.success) {
          wx.showToast({ title: "\u5df2\u89e3\u9664\u7ed1\u5b9a", icon: "success" });
        } else {
          wx.showToast({ title: "\u89e3\u9664\u5931\u8d25", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ unbinding: false });
        wx.showToast({ title: "\u8bf7\u6c42\u5931\u8d25", icon: "none" });
      }
    });
  }
});
