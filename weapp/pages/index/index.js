const api = require("../../utils/api");

Page({
  data: {
    status: null,
    gradeChanges: [],
    loading: true,
    error: null
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

  loadStatus() {
    this.setData({ loading: true, error: null });
    return Promise.all([
      api.request("/status"),
      api.request("/grade-changes")
    ]).then(([status, changesData]) => {
      status.lastCheckAtFormatted = this.formatTime(status.lastCheckAt);
      const changes = (changesData.changes || []).map(change => this.formatChange(change));
      this.setData({
        status,
        gradeChanges: changes,
        loading: false
      });
    }).catch(e => {
      if (e && e.code === "LOGIN_STATE_INVALID") {
        this.setData({
          error: "登录状态异常，请重新打开小程序",
          loading: false
        });
        return;
      }
      this.setData({
        error: "连接失败: " + (e.errMsg || e.message || "无法连接"),
        loading: false
      });
    });
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
