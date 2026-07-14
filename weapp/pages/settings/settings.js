const api = require("../../utils/api");
const app = getApp();
const { formatJwxtErrorMessage, isInvalidCredentials } = require("../../utils/jwxtError");

const BOUND_HINT_KEY = "jwxtBound";
const OLD_BOUND_HINT_KEY = "jwxtBoundHint";

function formatTime(t) {
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0") + " " +
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0");
}

function normalizeCode(value) {
  return String(value || "").toUpperCase();
}

function deriveStatus(status) {
  const hasBoundJwxt = Boolean(
    status &&
    (status.bound ||
      status.portalAuthStatus === "OK" ||
      status.cookieStatus === "account_saved" ||
      status.cookieStatus === "pending_verify")
  ) || Boolean(wx.getStorageSync(BOUND_HINT_KEY));

  const jwxtStatus = normalizeCode(status && status.jwxtStatus);
  const cookieStatus = normalizeCode(status && status.cookieStatus);

  if (!hasBoundJwxt) {
    return {
      status: "UNBOUND",
      tone: "muted",
      title: "未绑定教务账号",
      desc: "绑定后可自动同步课表、成绩和教务状态。",
      bound: false
    };
  }

  if (jwxtStatus === "SYNCING") {
    return {
      status: "SYNCING",
      tone: "warn",
      title: "正在同步教务数据",
      desc: "正在连接教务系统，请稍候。",
      bound: true
    };
  }

  if (jwxtStatus === "OK" || jwxtStatus === "SYNC_OK" || cookieStatus === "COOKIE_VALID") {
    return {
      status: "SYNC_OK",
      tone: "ok",
      title: "同步成功",
      desc: "教务数据已更新，可正常使用课表和成绩查询。",
      bound: true
    };
  }

  if (jwxtStatus === "UNAVAILABLE" || jwxtStatus === "JWXT_UNAVAILABLE" || jwxtStatus === "TIMEOUT" || cookieStatus === "JWXT_UNAVAILABLE" || cookieStatus === "JWXT_TIMEOUT") {
    return {
      status: "JWXT_UNAVAILABLE",
      tone: "warn",
      title: "教务系统暂时不可用",
      desc: "学校教务系统可能正在维护，请稍后再试。",
      bound: true
    };
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
    return {
      status: "SYNC_FAILED",
      tone: "err",
      title: "自动同步失败，需要重新验证",
      desc: "可能是密码变更、学校系统验证或教务系统维护导致，请重新绑定或稍后再试。",
      bound: true
    };
  }

  return {
    status: "BOUND",
    tone: "ok",
    title: "已绑定教务账号",
    desc: "系统会自动同步课表和成绩，无需重复登录。",
    bound: true
  };
}

function isTimeoutError(err) {
  const message = String((err && (err.message || err.errMsg)) || "").toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

Page({
  data: {
    apiAddr: app.globalData.apiBase,
    clientVersion: app.globalData.clientVersion || "0.1.4-jwt",
    loginStatus: "未连接",
    connectionError: "",
    debugExpanded: false,
    studentId: "",
    password: "",
    binding: false,
    unbinding: false,
    status: "UNBOUND",
    statusTitle: "未绑定教务账号",
    statusDesc: "绑定后可自动同步课表、成绩和教务状态。",
    statusTone: "muted",
    hasBoundJwxt: false,
    lastSyncText: "",
    syncMetaText: "",
    showRebindActions: false
  },

  onShow() {
    this.refreshStatus();
  },

  setDisplayStatus(display, extra) {
    this.setData(Object.assign({
      status: display.status,
      statusTitle: display.title,
      statusDesc: display.desc,
      statusTone: display.tone,
      hasBoundJwxt: display.bound,
      showRebindActions: display.status === "SYNC_FAILED"
    }, extra || {}));
  },

  refreshStatus() {
    this.setData({
      apiAddr: app.globalData.apiBase,
      clientVersion: app.globalData.clientVersion || "0.1.4-jwt"
    });

    api.request("/status")
      .then(status => {
        const display = deriveStatus(status || {});
        const lastSync = status && (status.lastSuccessfulSyncAt || status.lastCheckAt);
        const failedSync = status && status.lastFailedSyncAt;
        this.setDisplayStatus(display, {
          loginStatus: "已连接",
          connectionError: "",
          lastSyncText: formatTime(lastSync),
          syncMetaText: failedSync && display.status === "SYNC_FAILED" ? ("最近失败：" + formatTime(failedSync)) : ""
        });
      })
      .catch(err => {
        const display = deriveStatus(null);
        this.setDisplayStatus(display, {
          loginStatus: "未连接",
          connectionError: formatJwxtErrorMessage(err, app.globalData.lastLoginError || "无法连接 API"),
          lastSyncText: "",
          syncMetaText: ""
        });
      });
  },

  toggleDebug() {
    this.setData({ debugExpanded: !this.data.debugExpanded });
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
      wx.showToast({ title: "请输入学号和教务密码", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    this.setDisplayStatus({
      status: "SYNCING",
      tone: "warn",
      title: "正在同步教务数据",
      desc: "正在连接教务系统，请稍候。",
      bound: true
    });
    wx.showLoading({ title: "绑定中..." });

    try {
      const data = await api.post("/bind-account", { studentId, password }, { timeout: 120000 });
      wx.hideLoading();
      this.setData({ binding: false, password: "" });

      if (data && data.success === true && data.bound === true) {
        wx.setStorageSync(BOUND_HINT_KEY, true);
        wx.removeStorageSync(OLD_BOUND_HINT_KEY);
        const display = deriveStatus({
          bound: true,
          jwxtStatus: data.verified === true || data.jwxtStatus === "OK" ? "SYNC_OK" : (data.jwxtStatus || "BOUND"),
          portalAuthStatus: data.portalAuthStatus || "OK"
        });
        this.setDisplayStatus(display, { lastSyncText: data.verified === true ? formatTime(new Date().toISOString()) : "" });
        wx.showToast({ title: "绑定成功", icon: "success" });
        return;
      }

      this.handleBindFailure(data);
    } catch (err) {
      wx.hideLoading();
      this.setData({ binding: false });
      this.handleBindFailure(err);
    }
  },

  handleBindFailure(err) {
    if (isInvalidCredentials(err)) {
      this.setDisplayStatus({
        status: "UNBOUND",
        tone: "muted",
        title: "未绑定教务账号",
        desc: "绑定后可自动同步课表、成绩和教务状态。",
        bound: false
      });
      wx.showToast({ title: "学号或教务密码错误，请检查后重试", icon: "none" });
      return;
    }

    if (this.data.hasBoundJwxt || wx.getStorageSync(BOUND_HINT_KEY)) {
      this.setDisplayStatus({
        status: "SYNC_FAILED",
        tone: "err",
        title: "自动同步失败，需要重新验证",
        desc: "可能是密码变更、学校系统验证或教务系统维护导致，请重新绑定或稍后再试。",
        bound: true
      });
    } else {
      this.setDisplayStatus({
        status: "UNBOUND",
        tone: "muted",
        title: "未绑定教务账号",
        desc: "绑定后可自动同步课表、成绩和教务状态。",
        bound: false
      });
    }

    const fallback = isTimeoutError(err) ? "学校教务系统可能正在维护，请稍后再试。" : "绑定失败，请稍后再试。";
    wx.showModal({
      title: "绑定失败",
      content: formatJwxtErrorMessage(err, fallback),
      showCancel: false
    });
  },

  retryLater() {
    this.refreshStatus();
  },

  rebindAccount() {
    this.setData({ password: "" });
    this.setDisplayStatus({
      status: "UNBOUND",
      tone: "muted",
      title: "未绑定教务账号",
      desc: "绑定后可自动同步课表、成绩和教务状态。",
      bound: false
    });
  },

  unbindAccount() {
    if (!this.data.hasBoundJwxt) return;
    wx.showModal({
      title: "确认解除绑定",
      content: "解除后将删除已绑定的教务账号信息，课表和成绩将无法继续自动同步。",
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
      this.setData({ unbinding: false, password: "", studentId: "" });
      if (data && data.success) {
        wx.removeStorageSync(BOUND_HINT_KEY);
        wx.removeStorageSync(OLD_BOUND_HINT_KEY);
        this.setDisplayStatus({
          status: "UNBOUND",
          tone: "muted",
          title: "未绑定教务账号",
          desc: "绑定后可自动同步课表、成绩和教务状态。",
          bound: false
        }, { lastSyncText: "", syncMetaText: "" });
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
