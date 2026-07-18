const api = require("../../utils/api");
const { formatJwxtErrorMessage, isInvalidCredentials } = require("../../utils/jwxtError");

const BOUND_HINT_KEY = "jwxtBound";
const OLD_BOUND_HINT_KEY = "jwxtBoundHint";
const PRIVACY_ACCEPTED_KEY = "privacyAccepted";

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

function boundDisplay(status) {
  return {
    status: status || "BOUND",
    tone: "ok",
    title: "账号已绑定",
    desc: "系统将自动同步课表和成绩，无需重复操作。",
    bound: true
  };
}

function deriveStatus(status) {
  const serverBound = status && typeof status.bound === "boolean" ? status.bound : null;
  const hasBoundJwxt = serverBound !== null ? serverBound : (Boolean(
    status &&
    (status.portalAuthStatus === "OK" ||
      status.cookieStatus === "account_saved" ||
      status.cookieStatus === "pending_verify")
  ) || Boolean(wx.getStorageSync(BOUND_HINT_KEY)));

  const campusLoginStatus = normalizeCode(status && status.campusLoginStatus);
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

  if (campusLoginStatus === "RELOGIN_REQUIRED") {
    return {
      status: "SYNC_FAILED",
      tone: "err",
      title: "校园账号需要重新验证",
      desc: "自动恢复未成功，请确认密码是否已变更后重新绑定。",
      bound: true
    };
  }

  if (campusLoginStatus === "RECOVERING" || jwxtStatus === "SYNCING") {
    return boundDisplay();
  }

  if (campusLoginStatus === "VALID" || jwxtStatus === "OK" || jwxtStatus === "SYNC_OK" || cookieStatus === "COOKIE_VALID") {
    return boundDisplay("SYNC_OK");
  }

  if (jwxtStatus === "UNAVAILABLE" || jwxtStatus === "JWXT_UNAVAILABLE" || jwxtStatus === "TIMEOUT" || cookieStatus === "JWXT_UNAVAILABLE" || cookieStatus === "JWXT_TIMEOUT") {
    return boundDisplay();
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
    return boundDisplay();
  }

  return boundDisplay();
}

function isTimeoutError(err) {
  const message = String((err && (err.message || err.errMsg)) || "").toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

function errorCode(err) {
  return normalizeCode(err && (err.error || err.code || (err.data && err.data.error)));
}

function isTransientBindError(err) {
  const code = errorCode(err);
  return isTimeoutError(err) || [
    "PORTAL_UNAVAILABLE",
    "JWXT_UNAVAILABLE",
    "JWXT_TIMEOUT",
    "JWXT_SSO_FAILED",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN"
  ].includes(code);
}

function recoveringDisplay() {
  return boundDisplay();
}

Page({
  data: {
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
    showRebindActions: false,
    privacyAccepted: false
  },

  onShow() {
    this.setData({ privacyAccepted: Boolean(wx.getStorageSync(PRIVACY_ACCEPTED_KEY)) });
    this.refreshStatus();
  },

  onPrivacyChange(e) {
    const accepted = Boolean(e && e.detail && e.detail.value && e.detail.value.length);
    this.setData({ privacyAccepted: accepted });
    if (accepted) wx.setStorageSync(PRIVACY_ACCEPTED_KEY, true);
    else wx.removeStorageSync(PRIVACY_ACCEPTED_KEY);
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: "/pages/privacy/index" }) });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
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
    api.request("/status")
      .then(status => {
        const display = deriveStatus(status || {});
        const lastSync = status && (status.lastSuccessfulSyncAt || status.lastCheckAt);
        const failedSync = status && status.lastFailedSyncAt;
        this.setDisplayStatus(display, {
          lastSyncText: formatTime(lastSync),
          syncMetaText: failedSync && display.status === "SYNC_FAILED" ? ("最近失败：" + formatTime(failedSync)) : ""
        });
      })
      .catch(err => {
        const display = deriveStatus(null);
        this.setDisplayStatus(display, {
          lastSyncText: "",
          syncMetaText: ""
        });
      });
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
    if (!this.data.privacyAccepted) {
      wx.showToast({ title: "请先阅读并同意隐私保护指引", icon: "none" });
      return;
    }

    this.setData({ binding: true });
    this.setDisplayStatus({
      status: "SYNCING",
      tone: "muted",
      title: "正在验证账号",
      desc: "请稍候。",
      bound: true
    });
    try {
      const data = await api.post("/bind-account", { studentId, password }, { timeout: 120000 });
      this.setData({ binding: false, password: "" });

      if (data && data.success === true && data.bound === true) {
        wx.setStorageSync(BOUND_HINT_KEY, true);
        wx.removeStorageSync(OLD_BOUND_HINT_KEY);
        const display = boundDisplay(data.verified === true ? "SYNC_OK" : "BOUND");
        this.setDisplayStatus(display, { lastSyncText: data.verified === true ? formatTime(new Date().toISOString()) : "" });
        wx.showToast({
          title: "绑定成功",
          icon: "success"
        });
        return;
      }

      this.handleBindFailure(data);
    } catch (err) {
      this.setData({ binding: false });
      this.handleBindFailure(err);
    }
  },

  handleBindFailure(err) {
    const wasBound = Boolean(
      this.data.hasBoundJwxt ||
      wx.getStorageSync(BOUND_HINT_KEY) ||
      (err && err.data && err.data.bound)
    );

    if (isInvalidCredentials(err)) {
      this.setDisplayStatus(wasBound ? {
        status: "SYNC_FAILED",
        tone: "err",
        title: "校园账号需要重新验证",
        desc: "本次验证的账号或密码不正确，原绑定信息未被删除。",
        bound: true
      } : {
        status: "UNBOUND",
        tone: "muted",
        title: "未绑定教务账号",
        desc: "绑定后可自动同步课表、成绩和教务状态。",
        bound: false
      });
      wx.showToast({ title: "学号或教务密码错误", icon: "none" });
      return;
    }

    if (wasBound && isTransientBindError(err)) {
      this.setDisplayStatus(recoveringDisplay());
      wx.showToast({ title: "账号已绑定", icon: "success" });
      return;
    }

    if (wasBound) {
      this.setDisplayStatus(recoveringDisplay());
    } else {
      this.setDisplayStatus({
        status: "UNBOUND",
        tone: "muted",
        title: "未绑定教务账号",
        desc: "绑定后可自动同步课表、成绩和教务状态。",
        bound: false
      });
    }

    const transient = isTransientBindError(err);
    const fallback = transient ? "学校系统暂时不可用，本次未更改绑定信息，请稍后再试。" : "暂时无法验证账号，请稍后再试。";
    wx.showModal({
      title: transient ? "暂时无法验证" : "账号验证未完成",
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
