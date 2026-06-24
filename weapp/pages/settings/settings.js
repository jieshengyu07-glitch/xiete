const api = require("../../utils/api");
const app = getApp();
const { formatJwxtErrorMessage, isInvalidCredentials } = require("../../utils/jwxtError");

const CAPTCHA_RELAY_ENABLED = false;

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

function statusFromApi(status) {
  const bound = Boolean(status && status.bound);
  const jwxtStatus = String((status && status.jwxtStatus) || "");
  const cookieStatus = status && status.cookieStatus;
  if (!bound && (jwxtStatus === "LOGIN_REQUIRED" || cookieStatus === "login_required")) return { text: "未绑定", tone: "muted" };
  if (jwxtStatus === "CAPTCHA_REQUIRED" || cookieStatus === "JWXT_CAPTCHA_REQUIRED") return { text: "已绑定，需验证码验证", tone: "warn" };
  if (jwxtStatus === "COOKIE_EXPIRED" || cookieStatus === "cookie_expired") return { text: "已绑定，登录态已过期", tone: "warn" };
  if (jwxtStatus === "UNAVAILABLE" || cookieStatus === "JWXT_UNAVAILABLE") return { text: "已绑定，教务系统暂时不可用", tone: "warn" };
  if (jwxtStatus === "SSO_FAILED" || cookieStatus === "JWXT_SSO_FAILED") return { text: "已绑定，教务登录态获取失败", tone: "warn" };
  if (jwxtStatus === "TIMEOUT" || cookieStatus === "JWXT_TIMEOUT") return { text: "已绑定，教务系统响应超时", tone: "warn" };
  if (jwxtStatus === "OK") return { text: "已绑定", tone: "ok" };
  if (jwxtStatus === "LOGIN_FAILED" || cookieStatus === "login_failed") return { text: "已绑定，最近登录失败", tone: "err" };
  if (bound || cookieStatus === "cookie_valid" || cookieStatus === "account_saved" || cookieStatus === "pending_verify") {
    return { text: "已绑定", tone: "ok" };
  }
  return { text: "未绑定", tone: "muted" };
}

function shouldShowCaptchaFallback(err) {
  const code = String((err && (err.error || err.code || (err.data && err.data.error))) || "");
  const message = errorText(err) || String((err && err.message) || "");
  return code === "JWXT_CAPTCHA_REQUIRED" ||
    message.includes("需要验证码") ||
    message.includes("验证码验证");
}

Page({
  data: {
    apiAddr: app.globalData.apiBase,
    version: app.globalData.clientVersion || "0.1.4-jwt",
    clientVersion: app.globalData.clientVersion || "0.1.4-jwt",
    loginStatus: "未连接",
    connectionError: "",
    jwxtStatusText: "未绑定",
    jwxtStatusTone: "muted",
    debugExpanded: false,
    studentId: "",
    password: "",
    captchaSessionId: "",
    captchaImage: "",
    captchaCode: "",
    captchaExpanded: false,
    captchaRelayEnabled: CAPTCHA_RELAY_ENABLED,
    captchaFailureCount: 0,
    captchaLoading: false,
    captchaBinding: false,
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
      .then(status => {
        const jwxt = statusFromApi(status || {});
        this.setData({
          loginStatus: "已连接",
          connectionError: "",
          jwxtStatusText: jwxt.text,
          jwxtStatusTone: jwxt.tone
        });
      })
      .catch(err => this.setData({
        loginStatus: "未连接",
        jwxtStatusText: "登录失败",
        jwxtStatusTone: "err",
        connectionError: formatJwxtErrorMessage(err, app.globalData.lastLoginError || "无法连接 API")
      }));
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

  onCaptchaInput(e) {
    this.setData({ captchaCode: e.detail.value });
  },

  expandCaptcha(message) {
    const nextCount = Number(this.data.captchaFailureCount || 0) + 1;
    const content = nextCount >= 2
      ? "验证码验证失败，请先到官网登录完成验证后再回来重试。"
      : (message || "教务系统需要验证码验证，请先到官网登录教务系统完成验证后，再回到小程序重新绑定或刷新。");
    this.setData({
      captchaExpanded: true,
      captchaRelayEnabled: CAPTCHA_RELAY_ENABLED,
      captchaFailureCount: nextCount,
      jwxtStatusText: "需要验证码验证",
      jwxtStatusTone: "warn"
    });
    wx.showModal({
      title: "需要验证码验证",
      content,
      confirmText: "我已完成验证，重试",
      cancelText: "稍后再说",
      success: result => {
        if (result.confirm) this.retryAfterOfficialCaptcha();
      }
    });
  },

  async getCaptcha() {
    this.setData({ captchaExpanded: true, captchaLoading: true, captchaCode: "" });
    wx.showLoading({ title: "获取验证码..." });
    try {
      const data = await api.request("/jwxt/captcha-session", { timeout: 30000 });
      wx.hideLoading();
      this.setData({
        captchaLoading: false,
        captchaSessionId: data.sessionId || "",
        captchaImage: data.captchaImage || ""
      });
    } catch (err) {
      wx.hideLoading();
      this.setData({ captchaLoading: false });
      wx.showModal({
        title: "获取验证码失败",
        content: formatJwxtErrorMessage(err, "请稍后再试"),
        showCancel: false
      });
    }
  },

  async bindAccountWithCaptcha() {
    const studentId = String(this.data.studentId || "").trim();
    const password = String(this.data.password || "");
    const captcha = String(this.data.captchaCode || "").trim();
    const sessionId = String(this.data.captchaSessionId || "");

    if (!studentId || !password) {
      wx.showToast({ title: "请输入学号和密码", icon: "none" });
      return;
    }

    if (!sessionId) {
      wx.showToast({ title: "请先获取验证码", icon: "none" });
      return;
    }

    if (!captcha) {
      wx.showToast({ title: "请输入验证码", icon: "none" });
      return;
    }

    this.setData({ captchaBinding: true });
    wx.showLoading({ title: "验证中..." });
    try {
      const data = await api.post("/jwxt/login-with-captcha", { sessionId, studentId, password, captcha }, { timeout: 120000 });
      wx.hideLoading();
      this.setData({
        captchaBinding: false,
        password: "",
        captchaCode: "",
        captchaSessionId: "",
        captchaImage: "",
        captchaExpanded: false,
        jwxtStatusText: "已绑定",
        jwxtStatusTone: "ok"
      });
      wx.showModal({
        title: "绑定成功",
        content: (data && data.message) || "教务账号绑定成功",
        showCancel: false
      });
    } catch (err) {
      wx.hideLoading();
      const nextCount = Number(this.data.captchaFailureCount || 0) + 1;
      this.setData({ captchaBinding: false, captchaFailureCount: nextCount });
      if (nextCount >= 2) {
        wx.showModal({
          title: "验证码验证失败",
          content: "验证码验证失败，请先到官网登录完成验证后再回来重试。",
          showCancel: false
        });
        return;
      }
      wx.showModal({
        title: "验证失败",
        content: formatJwxtErrorMessage(err, "请重新获取验证码后再试"),
        showCancel: false
      });
    }
  },

  async bindAccount() {
    if (this.data.captchaExpanded && this.data.captchaRelayEnabled) {
      await this.bindAccountWithCaptcha();
      return;
    }

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

      if (data && data.success === true && data.bound === true && data.warning === true) {
        this.setData({ password: "", binding: false, jwxtStatusText: "已绑定，教务系统暂时不可用", jwxtStatusTone: "warn" });
        wx.showModal({
          title: "绑定已保存",
          content: "教务账号已保存，但教务系统暂时不可用。稍后可在课表或成绩页重新刷新。",
          showCancel: false
        });
        return;
      }

      if (data && data.success === true && data.bound === true && data.verified === false) {
        this.setData({ password: "", binding: false, jwxtStatusText: "已绑定", jwxtStatusTone: "ok" });
        wx.showModal({
          title: "账号已保存",
          content: "账号已保存，稍后可在首页检查成绩或刷新课表。",
          showCancel: false
        });
        return;
      }

      if (data && data.success === true && data.bound === true && data.verified === true) {
        this.setData({ password: "", binding: false, jwxtStatusText: "已绑定", jwxtStatusTone: "ok" });
        wx.showToast({ title: "绑定成功", icon: "success" });
        wx.showModal({
          title: "绑定成功",
          content: "教务账号绑定成功，可用于查询课表和成绩。",
          showCancel: false
        });
      } else {
        this.setData({ binding: false });
        if (isInvalidCredentials(data)) {
          wx.showToast({ title: "学号或教务密码错误，请检查后重试", icon: "none" });
          return;
        }
        if (shouldShowCaptchaFallback(data)) {
          this.expandCaptcha("教务系统需要验证码验证，请先到官网登录教务系统完成验证后，再回到小程序重新绑定或刷新。");
          return;
        }
        wx.showToast({ title: formatJwxtErrorMessage(data, "绑定失败"), icon: "none" });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ binding: false });
      const text = errorText(err);
      if (shouldShowCaptchaFallback(err)) {
        this.expandCaptcha("教务系统需要验证码验证，请先到官网登录教务系统完成验证后，再回到小程序重新绑定或刷新。");
        return;
      }
      if (isTimeoutError(err)) {
        wx.showModal({
          title: "绑定超时",
          content: "教务系统暂时不可用，请稍后再试",
          showCancel: false
        });
        return;
      }
      wx.showModal({
        title: "绑定失败",
        content: formatJwxtErrorMessage(err, app.globalData.lastLoginError || "请稍后再试"),
        showCancel: false
      });
    }
  },

  retryAfterOfficialCaptcha() {
    this.setData({
      captchaExpanded: false,
      captchaSessionId: "",
      captchaImage: "",
      captchaCode: ""
    });
    this.bindAccount();
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
        this.setData({ jwxtStatusText: "未绑定", jwxtStatusTone: "muted" });
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
