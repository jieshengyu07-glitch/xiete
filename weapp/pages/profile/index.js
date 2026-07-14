const app = getApp();

const TOKEN_KEY = "token";
const USER_INFO_KEY = "userInfo";
const JWXT_BOUND_KEY = "jwxtBound";
const OLD_JWXT_BOUND_HINT_KEY = "jwxtBoundHint";

function formatTime(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0") + " " +
    String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0");
}

function gradeStatusText(value) {
  if (value === "ready") return "可查询";
  if (value === "login_required") return "需要重新登录";
  if (value === "unavailable") return "暂不可用";
  return "暂无";
}

function gradeSourceText(value) {
  if (value === "xg" || value === "jwxt") return "校内成绩系统";
  return "暂无";
}

Page({
  data: {
    isWxLoggedIn: false,
    userInfo: null,
    status: null,
    jwtStatus: "未登录",
    gradeQueryStatusText: "暂无",
    gradeSourceText: "暂无",
    lastCheckAtText: "暂无",
    hasTimetableText: "未知",
    version: "",
    loadingStatus: false
  },

  onShow() {
    this.refreshLocalState();
  },

  refreshLocalState() {
    const token = wx.getStorageSync(TOKEN_KEY);
    const userInfo = wx.getStorageSync(USER_INFO_KEY) || null;

    if (!token) {
      this.setData({
        isWxLoggedIn: false,
        userInfo: null,
        status: null,
        jwtStatus: "未登录",
        gradeQueryStatusText: "暂无",
        gradeSourceText: "暂无",
        lastCheckAtText: "暂无",
        hasTimetableText: "未知",
        version: app.globalData.clientVersion || ""
      });
      return;
    }

    this.setData({
      isWxLoggedIn: true,
      userInfo: userInfo || { nickName: "科大同学" },
      jwtStatus: "已登录",
      version: app.globalData.clientVersion || ""
    });
    this.refreshStatus();
  },

  requestWithToken(path) {
    const token = wx.getStorageSync(TOKEN_KEY);
    return new Promise((resolve, reject) => {
      if (!token) {
        reject(new Error("NO_TOKEN"));
        return;
      }
      wx.request({
        url: app.globalData.apiBase + path,
        method: "GET",
        header: { Authorization: "Bearer " + token },
        timeout: 10000,
        success: res => {
          if (res.statusCode === 401) {
            this.clearLocalAuthState(false);
            reject(new Error("UNAUTHORIZED"));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error("HTTP " + res.statusCode));
            return;
          }
          resolve(res.data || {});
        },
        fail: reject
      });
    });
  },

  async refreshStatus() {
    const token = wx.getStorageSync(TOKEN_KEY);
    if (!token) {
      this.refreshLocalState();
      return;
    }

    this.setData({ loadingStatus: true });
    try {
      const status = await this.requestWithToken("/status");
      const bound = status.bound === true;
      if (bound) {
        wx.setStorageSync(JWXT_BOUND_KEY, true);
      } else {
        wx.removeStorageSync(JWXT_BOUND_KEY);
      }
      wx.removeStorageSync(OLD_JWXT_BOUND_HINT_KEY);

      this.setData({
        status,
        isWxLoggedIn: true,
        jwtStatus: "已登录",
        gradeQueryStatusText: gradeStatusText(status.gradeQueryStatus),
        gradeSourceText: gradeSourceText(status.gradeSource),
        lastCheckAtText: formatTime(status.lastCheckAt),
        hasTimetableText: status.hasTimetable ? "已同步" : "未同步",
        version: status.version || app.globalData.clientVersion || "",
        loadingStatus: false
      });
    } catch (err) {
      this.setData({
        jwtStatus: wx.getStorageSync(TOKEN_KEY) ? "已登录" : "未登录",
        gradeQueryStatusText: "暂不可用",
        gradeSourceText: "暂无",
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
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  confirmClearCache() {
    wx.showModal({
      title: "清除本地缓存",
      content: "会清除本地登录态和页面缓存，不会删除后端账号数据。确定继续吗？",
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
      jwtStatus: "未登录",
      gradeQueryStatusText: "暂无",
      gradeSourceText: "暂无",
      lastCheckAtText: "暂无",
      hasTimetableText: "未知",
      loadingStatus: false
    });
    if (showToast !== false) {
      wx.showToast({ title: "已清除本地缓存", icon: "none" });
    }
  }
});
