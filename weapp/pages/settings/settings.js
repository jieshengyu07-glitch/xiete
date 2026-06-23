const api = require("../../utils/api");
const app = getApp();

function isTimeoutError(err) {
  const message = String((err && (err.message || err.errMsg)) || "").toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

function errorText(err) {
  if (!err) return "";
  if (err.message) return String(err.message);
  if (err.errMsg) return String(err.errMsg);
  if (err.data && err.data.message) return String(err.data.message);
  if (err.data && err.data.error) return String(err.data.error);
  if (err.statusCode) return "HTTP " + err.statusCode;
  return "";
}

Page({
  data: {
    apiAddr: app.globalData.apiBase,
    version: app.globalData.clientVersion || "0.1.4-jwt",
    clientVersion: app.globalData.clientVersion || "0.1.4-jwt",
    loginStatus: "未连接",
    connectionError: "",
    studentId: "",
    password: "",
    binding: false,
    unbinding: false
  },

  onShow() {
    this.refreshDebugInfo();
  },

  refreshDebugInfo() {
    this.setData({
      apiAddr: app.globalData.apiBase,
      version: app.globalData.clientVersion || "0.1.4-jwt",
      clientVersion: app.globalData.clientVersion || "0.1.4-jwt"
    });
    api.request("/status")
      .then(() => this.setData({ loginStatus: "已连接", connectionError: "" }))
      .catch(err => this.setData({
        loginStatus: "未连接",
        connectionError: errorText(err) || app.globalData.lastLoginError || "无法连接 API"
      }));
  },

  onStudentIdInput(e) {
    this.setData({ studentId: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  async bindAccount() {
    const studentId = String(this.data.studentId || "").trim();
    const password = String(this.data.password || "");

    if (!studentId || !password) {
      wx.showToast({ title: "请输入学号和密码", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    wx.showLoading({ title: "绑定中..." });

    try {
      const data = await api.post("/bind-account", { studentId, password }, { timeout: 120000 });
      wx.hideLoading();

      if (data && data.success === true && data.bound === true && data.verified === false) {
        this.setData({ password: "", binding: false });
        wx.showModal({
          title: "账号已保存",
          content: data.reason === "jwxt_unavailable" ?
            "教务系统暂时不可用，稍后可在首页点击检查成绩。" :
            "账号已保存，稍后可在首页点击检查成绩。",
          showCancel: false
        });
        return;
      }

      if (data && data.success === true && data.bound === true && data.verified === true) {
        this.setData({ password: "", binding: false });
        wx.showToast({ title: "绑定成功", icon: "success" });
        wx.showModal({
          title: "绑定成功",
          content: "绑定成功，之后可自动查成绩。请回首页点击“立即检查成绩”。",
          showCancel: false
        });
      } else {
        this.setData({ binding: false });
        if (data && data.error === "invalid_credentials") {
          wx.showToast({ title: "账号或密码错误", icon: "none" });
          return;
        }
        if (data && data.error === "captcha_required") {
          wx.showToast({ title: "需要验证码或风控校验", icon: "none" });
          return;
        }
        wx.showToast({ title: (data && data.message) || "绑定失败", icon: "none" });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ binding: false });
      if (isTimeoutError(err)) {
        wx.showModal({
          title: "绑定超时",
          content: "教务系统响应较慢，请稍后重试。",
          showCancel: false
        });
        return;
      }
      wx.showModal({
        title: "绑定失败",
        content: errorText(err) || app.globalData.lastLoginError || "请检查 API 域名、微信登录配置和后端日志。",
        showCancel: false
      });
    }
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
