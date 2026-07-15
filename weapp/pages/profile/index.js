const app = getApp();
const api = require("../../utils/api");

const TOKEN_KEY = "token";
const USER_INFO_KEY = "userInfo";
const JWXT_BOUND_KEY = "jwxtBound";
const OLD_JWXT_BOUND_HINT_KEY = "jwxtBoundHint";

function friendlyTime(value) {
  if (!value) return "暂无同步记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60 * 1000) return "刚刚同步";
  if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + "分钟前同步";
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + "小时前同步";

  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0") + " " +
    String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0");
}

function gradeStatusInfo(value) {
  if (value === "ready") return { text: "可查询", className: "ok" };
  if (value === "not_bound") return { text: "未绑定校园账号", className: "muted" };
  if (value === "recovering") return { text: "正在恢复登录状态", className: "muted" };
  if (value === "login_required") return { text: "需要重新登录", className: "warn" };
  if (value === "unavailable") return { text: "暂不可用", className: "muted" };
  return { text: "暂无状态", className: "muted" };
}

function displayName(userInfo) {
  return (userInfo && (userInfo.nickName || userInfo.studentId || userInfo.name)) || "校园助手用户";
}

function avatarLetter(name) {
  return String(name || "校").slice(0, 1);
}

Page({
  data: {
    isWxLoggedIn: false,
    userInfo: null,
    status: null,
    displayName: "校园助手用户",
    avatarLetter: "校",
    avatarUrl: "",
    profileDesc: "登录后可查看校园数据",
    bindStatusText: "未绑定",
    bindStatusClass: "muted",
    bindButtonText: "校园账号登录",
    gradeQueryStatusText: "暂无状态",
    gradeStatusClass: "muted",
    lastCheckAtText: "暂无同步记录",
    loadingStatus: false
  },

  onShow() {
    this._profilePageActive = true;
    this._statusPollAttempts = 0;
    this.refreshLocalState();
  },

  onHide() {
    this._profilePageActive = false;
    this.stopStatusPolling();
  },

  onUnload() {
    this._profilePageActive = false;
    this.stopStatusPolling();
  },

  refreshLocalState() {
    const token = wx.getStorageSync(TOKEN_KEY);
    const userInfo = wx.getStorageSync(USER_INFO_KEY) || null;
    const name = displayName(userInfo);

    if (!token) {
      this.setData({
        isWxLoggedIn: false,
        userInfo: null,
        status: null,
        displayName: "校园助手用户",
        avatarLetter: "校",
        avatarUrl: "",
        profileDesc: "登录后可查看成绩和课表",
        bindStatusText: "未绑定",
        bindStatusClass: "muted",
        bindButtonText: "校园账号登录",
        gradeQueryStatusText: "暂无状态",
        gradeStatusClass: "muted",
        lastCheckAtText: "暂无同步记录",
        loadingStatus: false
      });
      return;
    }

    this.setData({
      isWxLoggedIn: true,
      userInfo: userInfo || { nickName: "校园助手用户" },
      displayName: name,
      avatarLetter: avatarLetter(name),
      avatarUrl: userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : "",
      profileDesc: "已登录校园助手"
    });
    this.refreshStatus();
  },

  requestWithToken(path) {
    return api.request(path, { timeout: 10000 });
  },

  stopStatusPolling() {
    if (this._statusPollTimer) {
      clearTimeout(this._statusPollTimer);
      this._statusPollTimer = null;
    }
  },

  scheduleStatusPolling() {
    this.stopStatusPolling();
    if (!this._profilePageActive) return;
    this._statusPollAttempts = Number(this._statusPollAttempts || 0) + 1;
    if (this._statusPollAttempts > 10) return;
    this._statusPollTimer = setTimeout(() => {
      this._statusPollTimer = null;
      if (this._profilePageActive) this.refreshStatus({ polling: true });
    }, 2000);
  },

  async refreshStatus(options) {
    const token = wx.getStorageSync(TOKEN_KEY);
    if (!token) {
      this.refreshLocalState();
      return;
    }

    this.setData({ loadingStatus: true });
    try {
      const status = await this.requestWithToken("/status");
      const bound = status.bound === true;
      const gradeInfo = gradeStatusInfo(status.gradeQueryStatus);

      if (bound) {
        wx.setStorageSync(JWXT_BOUND_KEY, true);
      } else {
        wx.removeStorageSync(JWXT_BOUND_KEY);
      }
      wx.removeStorageSync(OLD_JWXT_BOUND_HINT_KEY);

      this.setData({
        status,
        isWxLoggedIn: true,
        profileDesc: "已登录校园助手",
        bindStatusText: bound ? "已绑定" : "未绑定",
        bindStatusClass: bound ? "ok" : "muted",
        bindButtonText: bound ? "管理校园账号" : "校园账号登录",
        gradeQueryStatusText: gradeInfo.text,
        gradeStatusClass: gradeInfo.className,
        lastCheckAtText: friendlyTime(status.lastCheckAt || status.lastSuccessfulSyncAt),
        loadingStatus: false
      });
      if (status.sessionRecoveryPending || status.gradeQueryStatus === "recovering") {
        this.scheduleStatusPolling();
      } else {
        this.stopStatusPolling();
      }
    } catch (err) {
      this.stopStatusPolling();
      this.setData({
        gradeQueryStatusText: "暂不可用",
        gradeStatusClass: "muted",
        lastCheckAtText: "暂无同步记录",
        loadingStatus: false
      });
      wx.showToast({ title: "状态刷新失败", icon: "none" });
    }
  },

  relogin() {
    wx.showLoading({ title: "登录中..." });
    app.loginWithWechat(true).then(() => {
      wx.hideLoading();
      wx.showToast({ title: "登录成功", icon: "success" });
      this.refreshLocalState();
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: "登录失败", icon: "none" });
    });
  },

  openLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  manageJwxt() {
    if (!this.data.isWxLoggedIn) {
      this.relogin();
      return;
    }
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  confirmClearCache() {
    wx.showModal({
      title: "清除本地缓存",
      content: "会清除本地登录状态和页面缓存，不会删除后端账号数据。确定继续吗？",
      confirmText: "清除",
      confirmColor: "#d92d20",
      success: result => {
        if (result.confirm) this.clearLocalAuthState(true);
      }
    });
  },

  clearLocalAuthState(showToast) {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_INFO_KEY);
    wx.removeStorageSync(JWXT_BOUND_KEY);
    wx.removeStorageSync(OLD_JWXT_BOUND_HINT_KEY);
    this.setData({
      isWxLoggedIn: false,
      userInfo: null,
      status: null,
      displayName: "校园助手用户",
      avatarLetter: "校",
      avatarUrl: "",
      profileDesc: "登录后可查看成绩和课表",
      bindStatusText: "未绑定",
      bindStatusClass: "muted",
      bindButtonText: "校园账号登录",
      gradeQueryStatusText: "暂无状态",
      gradeStatusClass: "muted",
      lastCheckAtText: "暂无同步记录",
      loadingStatus: false
    });
    if (showToast !== false) {
      wx.showToast({ title: "已清除本地缓存", icon: "none" });
    }
  }
});
