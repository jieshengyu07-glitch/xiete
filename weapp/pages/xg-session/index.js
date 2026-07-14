const api = require("../../utils/api");

function errorCode(err) {
  return String((err && (err.code || err.error || (err.data && err.data.error))) || "");
}

function isNetworkError(err) {
  const text = String((err && (err.errMsg || err.message)) || "").toLowerCase();
  return text.includes("request:fail") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("failed");
}

Page({
  data: {
    xgScoreUrl: "",
    xgCookies: "",
    saving: false
  },

  onUrlInput(e) {
    this.setData({ xgScoreUrl: e.detail.value || "" });
  },

  onCookieInput(e) {
    this.setData({ xgCookies: e.detail.value || "" });
  },

  validateInput() {
    const xgScoreUrl = this.data.xgScoreUrl.trim();
    const xgCookies = this.data.xgCookies.trim();

    if (!xgScoreUrl || !xgCookies) {
      wx.showToast({ title: "请填写 URL 和 Cookie", icon: "none" });
      return null;
    }
    if (xgScoreUrl.indexOf("xg.tyust.edu.cn") === -1) {
      wx.showToast({ title: "URL 必须包含 xg.tyust.edu.cn", icon: "none" });
      return null;
    }
    if (xgScoreUrl.indexOf("StuStudentScore.aspx") === -1) {
      wx.showToast({ title: "请检查 URL 是否为成绩页面", icon: "none" });
      return null;
    }

    return { xgScoreUrl, xgCookies };
  },

  async saveSession() {
    const payload = this.validateInput();
    if (!payload || this.data.saving) return;

    this.setData({ saving: true });
    wx.showLoading({ title: "保存中..." });
    try {
      await api.post("/upload-xg-session", payload, { timeout: 30000 });
      wx.hideLoading();
      this.setData({ saving: false, xgCookies: "" });
      wx.showToast({ title: "学工成绩渠道已配置", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 600);
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      const code = errorCode(err);
      if (code === "UNAUTHORIZED" || code === "AUTH_REQUIRED") {
        wx.showToast({ title: "登录已失效，请重新登录", icon: "none" });
        return;
      }
      if (isNetworkError(err)) {
        wx.showToast({ title: "无法连接服务器", icon: "none" });
        return;
      }
      wx.showToast({ title: "请检查 URL 和 Cookie", icon: "none" });
    }
  }
});
