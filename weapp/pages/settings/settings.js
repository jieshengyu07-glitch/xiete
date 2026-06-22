const app = getApp();

Page({
  data: {
    apiAddr: app.globalData.apiBase,
    version: "1.0.0",
    studentId: "",
    password: "",
    binding: false
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
      wx.showToast({ title: "请输入学号和密码", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    wx.showLoading({ title: "绑定中..." });

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
          wx.showToast({ title: "绑定成功", icon: "success" });
          wx.showModal({
            title: "绑定成功",
            content: "绑定成功，之后可自动查成绩",
            showCancel: false
          });
        } else {
          this.setData({ binding: false });
          wx.showToast({ title: data.message || "账号或密码错误", icon: "none" });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ binding: false });
        wx.showToast({ title: "教务系统不可用", icon: "none" });
      }
    });
  }
});
