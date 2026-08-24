const app = getApp();
const api = require("../../utils/api");
const { wechatPresentation, campusPresentation, timetablePresentation, gradesPresentation } = require("../../utils/statusPresenter");

const TOKEN_KEY = "token";
const USER_INFO_KEY = "userInfo";
const JWXT_BOUND_KEY = "jwxtBound";
const OLD_JWXT_BOUND_HINT_KEY = "jwxtBoundHint";
const MANUAL_LOGOUT_KEY = "manualLogout";

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
    bindButtonText: "微信快捷登录",
    wechatStatusText: "未登录",
    wechatStatusClass: "muted",
    campusStatusText: "还没有绑定校园账号",
    campusStatusClass: "muted",
    campusDescriptionText: "绑定后即可同步课表和成绩。",
    isCampusBound: false,
    timetableStatusText: "还没有同步课表",
    timetableStatusClass: "muted",
    timetableSyncTimeText: "",
    gradeQueryStatusText: "暂无状态",
    gradeStatusClass: "muted",
    gradesSyncTimeText: "",
    lastCheckAtText: "暂无同步记录",
    loadingStatus: false,
    deletingData: false
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
      const wechatInfo = wechatPresentation({ token: "" });
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
        bindButtonText: "微信快捷登录",
        wechatStatusText: wechatInfo.title,
        wechatStatusClass: wechatInfo.level,
        campusStatusText: "登录后可绑定校园账号",
        campusStatusClass: "muted",
        campusDescriptionText: "先完成微信登录，再绑定校园账号。",
        isCampusBound: false,
        timetableStatusText: "登录后可同步课表",
        timetableStatusClass: "muted",
        timetableSyncTimeText: "",
        gradeQueryStatusText: "暂无状态",
        gradeStatusClass: "muted",
        gradesSyncTimeText: "",
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

    const manual = Boolean(options && options.manual);
    if (manual) this.setData({ loadingStatus: true });
    try {
      const status = await this.requestWithToken("/status");
      const bound = status.bound === true;
      const product = status.productStatus || {};
      const wechatInfo = wechatPresentation(product.wechat || { token });
      const accountInfo = campusPresentation(Object.assign({}, status, { account: product.account }));
      const timetableInfo = timetablePresentation(Object.assign({}, status, {
        timetable: product.timetable,
        termStatus: product.timetable && product.timetable.termStatus,
        updatedAt: product.timetable && product.timetable.updatedAt
      }));
      const gradeInfo = gradesPresentation(Object.assign({}, status, {
        grades: product.grades,
        hasGrades: Number(status.totalGrades || 0) > 0,
        updatedAt: product.grades && product.grades.updatedAt
      }));

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
        bindStatusText: accountInfo.title,
        bindStatusClass: accountInfo.level,
        bindButtonText: accountInfo.actionText || "管理校园账号",
        wechatStatusText: wechatInfo.title,
        wechatStatusClass: wechatInfo.level,
        campusStatusText: accountInfo.title,
        campusStatusClass: accountInfo.level,
        campusDescriptionText: accountInfo.state === "UNBOUND" ? "绑定后即可同步课表和成绩。" : accountInfo.description,
        isCampusBound: bound,
        timetableStatusText: timetableInfo.title,
        timetableStatusClass: timetableInfo.level,
        timetableSyncTimeText: timetableInfo.updatedAtText,
        gradeQueryStatusText: gradeInfo.title,
        gradeStatusClass: gradeInfo.level,
        gradesSyncTimeText: gradeInfo.updatedAtText,
        lastCheckAtText: gradeInfo.updatedAtText || timetableInfo.updatedAtText || "暂无同步记录",
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
        campusStatusText: "状态暂时无法刷新",
        campusStatusClass: "warn",
        timetableStatusText: "状态暂时无法刷新",
        timetableStatusClass: "warn",
        gradeQueryStatusText: "状态暂时无法刷新",
        gradeStatusClass: "warn",
        lastCheckAtText: "暂无同步记录",
        loadingStatus: false
      });
      wx.showToast({ title: "状态刷新失败", icon: "none" });
    }
  },

  verifyAccountStatus() {
    this.refreshStatus({ manual: true });
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
      this.openLogin();
      return;
    }
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: "/pages/privacy/index" }) });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
  },

  deleteCloudData() {
    if (!this.data.isWxLoggedIn || this.data.deletingData) return;
    wx.showModal({
      title: "删除个人数据",
      content: "将永久删除云端保存的校园账号、登录会话、成绩和课表缓存。此操作不可恢复，确定继续吗？",
      confirmText: "永久删除",
      confirmColor: "#d92d20",
      success: result => {
        if (!result.confirm) return;
        this.setData({ deletingData: true });
        api.del("/account/data", {}, { timeout: 120000 }).then(() => {
          this.setData({ deletingData: false });
          this.clearLocalAuthState(false);
          wx.showToast({ title: "个人数据已删除", icon: "success" });
        }).catch(err => {
          this.setData({ deletingData: false });
          const code = String((err && (err.error || err.code || (err.data && err.data.error))) || "");
          wx.showToast({
            title: code === "DATA_SYNC_IN_PROGRESS" ? "数据同步中，请稍后再试" : "删除失败，请稍后重试",
            icon: "none"
          });
        });
      }
    });
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
    if (api && typeof api.clearPendingAuthRequests === "function") api.clearPendingAuthRequests();
    wx.setStorageSync(MANUAL_LOGOUT_KEY, true);
    if (app && typeof app.invalidateAuth === "function") app.invalidateAuth();
    else wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_INFO_KEY);
    wx.removeStorageSync(JWXT_BOUND_KEY);
    wx.removeStorageSync(OLD_JWXT_BOUND_HINT_KEY);
    if (app && app.globalData && typeof app.invalidateAuth !== "function") {
      app.globalData.authEpoch = Number(app.globalData.authEpoch || 0) + 1;
    }
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
      wechatStatusText: "未登录",
      wechatStatusClass: "muted",
      campusStatusText: "登录后可绑定校园账号",
      campusStatusClass: "muted",
      campusDescriptionText: "先完成微信登录，再绑定校园账号。",
      isCampusBound: false,
      timetableStatusText: "登录后可同步课表",
      timetableStatusClass: "muted",
      timetableSyncTimeText: "",
      gradeQueryStatusText: "暂无状态",
      gradeStatusClass: "muted",
      gradesSyncTimeText: "",
      lastCheckAtText: "暂无同步记录",
      loadingStatus: false
    });
    if (showToast !== false) {
      wx.showToast({ title: "已清除本地缓存", icon: "none" });
    }
  }
});
