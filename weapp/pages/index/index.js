const api = require("../../utils/api");

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
      (d.getMonth() + 1).toString().padStart(2, "0") + "-" +
      d.getDate().toString().padStart(2, "0") + " " +
      d.getHours().toString().padStart(2, "0") + ":" +
      d.getMinutes().toString().padStart(2, "0");
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

  isLoginStateError(e) {
    return Boolean(e && (
      e.statusCode === 401 ||
      e.error === "INVALID_TOKEN" ||
      e.code === "INVALID_TOKEN" ||
      e.code === "LOGIN_STATE_INVALID"
    ));
  },

  isNetworkError(e) {
    const text = String((e && (e.errMsg || e.message)) || "").toLowerCase();
    return text.includes("request:fail") ||
      text.includes("timeout") ||
      text.includes("timed out") ||
      text.includes("network") ||
      text.includes("无法连接");
  },

  statusMessage(cookieStatus) {
    if (cookieStatus === "login_required") return "请先绑定教务账号";
    if (cookieStatus === "account_saved" || cookieStatus === "pending_verify") return "账号已保存，请点击立即检查成绩";
    if (cookieStatus === "jwxt_unavailable") return "教务系统暂时不可用，请稍后再试";
    return "";
  },

  async loadStatus() {
    this.setData({ loading: true, error: null, errorTitle: "", statusMessage: "" });
    try {
      const status = await api.request("/status");
      let changesData = { changes: [] };
      try {
        changesData = await api.request("/grade-changes");
      } catch (changesErr) {
        if (this.isLoginStateError(changesErr)) throw changesErr;
      }

      status.lastCheckAtFormatted = this.formatTime(status.lastCheckAt);
      const changes = (changesData.changes || []).map(change => this.formatChange(change));
      this.setData({
        status,
        gradeChanges: changes,
        statusMessage: this.statusMessage(status.cookieStatus),
        loading: false
      });
    } catch (e) {
      if (this.isLoginStateError(e)) {
        this.setData({
          errorTitle: "登录状态异常",
          error: "登录状态异常，请重新打开小程序",
          loading: false
        });
        return;
      }
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
        if (d.cookieStatus === "jwxt_unavailable" || d.error === "jwxt_unavailable") {
          wx.showModal({
            title: "检查失败",
            content: "教务系统暂时不可用，请稍后再试",
            showCancel: false
          });
          this.loadStatus();
          return;
        }
        wx.showToast({ title: d.error || "检查失败", icon: "none" });
      }
      this.loadStatus();
    }).catch(e => {
      wx.hideLoading();
      if (e && e.code === "LOGIN_STATE_INVALID") {
        wx.showToast({ title: "登录状态异常，请重新打开小程序", icon: "none" });
        return;
      }
      wx.showToast({ title: "请求失败", icon: "none" });
    });
  }
});
