const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired } = require("../../utils/jwxtError");

function showCaptchaRequired(onRetry) {
  wx.showModal({
    title: "自动同步失败，需要重新验证",
    content: "可能是学校系统验证或教务系统维护导致，请稍后再试，或到设置页重新绑定教务账号。",
    confirmText: "稍后再试",
    cancelText: "知道了",
    success: result => {
      if (result.confirm && typeof onRetry === "function") onRetry();
    }
  });
}

Page({
  data: {
    status: null,
    gradeChanges: [],
    loading: true,
    error: null,
    errorTitle: "",
    statusMessage: ""
  },

  onShow() {
    this.loadStatus();
  },

  onPullDownRefresh() {
    this.loadStatus().then(() => wx.stopPullDownRefresh());
  },

  formatTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
  },

  formatChange(change) {
    const term = change.termName || "";
    const courseName = change.kcmc || "";
    if (!courseName) {
      return {
        ...change,
        displayType: "更新",
        displayText: "检测到成绩数据更新"
      };
    }
    if (change.type === "changed") {
      return {
        ...change,
        displayType: "变化",
        displayText: courseName + " " + (change.oldCj || "") + " -> " + (change.newCj || "") + " " + term
      };
    }
    return {
      ...change,
      displayType: "新增",
      displayText: courseName + " " + (change.newCj || "") + " " + term
    };
  },

  isNetworkError(e) {
    const text = String((e && (e.errMsg || e.message)) || "").toLowerCase();
    return text.includes("request:fail") ||
      text.includes("timeout") ||
      text.includes("timed out") ||
      text.includes("network") ||
      text.includes("无法连接");
  },

  statusMessage(status) {
    if (!status || !status.bound) return "未绑定教务账号。绑定后可自动同步课表、成绩和教务状态。";

    const jwxtStatus = String(status.jwxtStatus || "").toUpperCase();
    const cookieStatus = String(status.cookieStatus || "").toUpperCase();

    if (jwxtStatus === "OK" || jwxtStatus === "SYNC_OK" || cookieStatus === "COOKIE_VALID") {
      return "同步成功。教务数据已更新，可正常使用课表和成绩查询。";
    }
    if (jwxtStatus === "UNAVAILABLE" || jwxtStatus === "TIMEOUT" || cookieStatus === "JWXT_UNAVAILABLE" || cookieStatus === "JWXT_TIMEOUT") {
      return "教务系统暂时不可用。学校教务系统可能正在维护，请稍后再试。";
    }
    if (
      jwxtStatus === "LOGIN_FAILED" ||
      jwxtStatus === "CAPTCHA_REQUIRED" ||
      jwxtStatus === "COOKIE_EXPIRED" ||
      jwxtStatus === "SSO_FAILED" ||
      cookieStatus === "LOGIN_FAILED" ||
      cookieStatus === "JWXT_CAPTCHA_REQUIRED" ||
      cookieStatus === "COOKIE_EXPIRED" ||
      cookieStatus === "JWXT_SSO_FAILED"
    ) {
      return "自动同步失败，需要重新验证。可能是密码变更、学校系统验证或教务系统维护导致。";
    }
    return "已绑定教务账号。系统会自动同步课表和成绩，无需重复登录。";
  },

  async loadStatus() {
    this.setData({ loading: true, error: null, errorTitle: "", statusMessage: "" });
    try {
      const status = await api.request("/status");
      let changesData = { changes: [] };
      try {
        changesData = await api.request("/grade-changes");
      } catch (changesErr) {}

      status.lastCheckAtFormatted = this.formatTime(status.lastCheckAt);
      const changes = (changesData.changes || []).map(change => this.formatChange(change));
      this.setData({
        status,
        gradeChanges: changes,
        statusMessage: this.statusMessage(status),
        loading: false
      });
    } catch (e) {
      const networkError = this.isNetworkError(e);
      this.setData({
        errorTitle: networkError ? "连接异常" : "加载失败",
        error: networkError ? "连接异常" : "加载失败",
        loading: false
      });
    }
  },

  refresh() {
    this.loadStatus();
  },

  doCheck() {
    wx.showLoading({ title: "检查中..." });
    api.post("/check").then(d => {
      wx.hideLoading();
      if (d.checked) {
        wx.showToast({ title: "检查完成", icon: "success" });
        if (d.changeCount) {
          wx.showModal({
            title: "成绩变化",
            content: "本次发现 " + d.changeCount + " 条成绩变化",
            showCancel: false
          });
        }
      } else {
        if (isCaptchaRequired(d)) {
          showCaptchaRequired(() => this.doCheck());
          this.loadStatus();
          return;
        }
        if (d.hasCache || d.fromCache || d.warning) {
          wx.showToast({
            title: d.message || "教务系统暂时不可用，当前显示上次查询成绩",
            icon: "none"
          });
          this.loadStatus();
          return;
        }
        wx.showToast({ title: formatJwxtErrorMessage(d, "检查失败"), icon: "none" });
      }
      this.loadStatus();
    }).catch(e => {
      wx.hideLoading();
      if (isCaptchaRequired(e)) {
        showCaptchaRequired(() => this.doCheck());
        return;
      }
      wx.showToast({ title: formatJwxtErrorMessage(e, "请求失败"), icon: "none" });
    });
  }
});
