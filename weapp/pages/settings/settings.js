const api = require("../../utils/api");
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
      wx.showToast({ title: "请输入学号和密码", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    wx.showLoading({ title: "绑定中..." });

    api.post("/bind-account", { studentId, password }, { timeout: 120000 }).then(data => {
      wx.hideLoading();
      if (data && data.success) {
        this.setData({ password: "", binding: false });
        wx.showToast({ title: "绑定成功", icon: "success" });
        wx.showModal({
          title: "绑定成功",
          content: "绑定成功，之后可自动查成绩。请回首页点击“立即检查成绩”。",
          showCancel: false
        });
      } else {
        this.setData({ binding: false });
        wx.showToast({ title: (data && data.message) || "账号或密码错误", icon: "none" });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ binding: false });
      wx.showToast({ title: "教务系统不可用", icon: "none" });
    });
  },

  unbindAccount() {
    wx.showModal({
      title: "确认解除绑定",
      content: "解除后将删除本地绑定账号和 Cookie，不会删除已存成绩。",
      confirmText: "解除绑定",
      confirmColor: "#e74c3c",
      success: result => {
        if (!result.confirm) return;
        this.doUnbindAccount();
      }
    });
  },

  doUnbindAccount() {
    this.setData({ unbinding: true });
    wx.showLoading({ title: "解除中..." });

    api.post("/unbind-account", {}, { timeout: 30000 }).then(data => {
      wx.hideLoading();
      this.setData({ unbinding: false, password: "" });
      if (data && data.success) {
        wx.showToast({ title: "已解除绑定", icon: "success" });
      } else {
        wx.showToast({ title: "解除失败", icon: "none" });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ unbinding: false });
      wx.showToast({ title: "请求失败", icon: "none" });
    });
  }
});
