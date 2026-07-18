const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired, isLoginRequired } = require("../../utils/jwxtError");
const MANUAL_LOGOUT_KEY = "manualLogout";

const WEEKDAY_NAMES = ["", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const SECTION_TIMES = {
  1: "08:00-09:40",
  2: "10:00-11:40",
  3: "14:30-16:10",
  4: "16:30-18:10"
};

function defaultSections() {
  return [1, 2, 3, 4].map(section => ({
    section,
    title: "第" + section + "大节",
    timeText: SECTION_TIMES[section] || "",
    courses: []
  }));
}

function displayDate(value) {
  if (!value) return "";
  const parts = String(value).split("-");
  if (parts.length !== 3) return value;
  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
}

function normalizeWeekType(data) {
  if (data.weekTypeText || data.weekTypeName) return data.weekTypeText || data.weekTypeName;
  if (data.weekType === "ODD") return "单周";
  if (data.weekType === "EVEN") return "双周";
  return "单双周";
}

function normalizeSections(sections) {
  const source = Array.isArray(sections) && sections.length ? sections : defaultSections();
  return source.map(item => {
    const section = Number(item.section);
    return {
      ...item,
      section,
      title: item.title || ("第" + section + "大节"),
      timeText: item.timeText || SECTION_TIMES[section] || "",
      courses: Array.isArray(item.courses) ? item.courses : []
    };
  });
}

function showCaptchaRequired(onRetry) {
  wx.showModal({
    title: "需要验证码验证",
    content: "教务系统需要验证码验证，请先到官网登录教务系统完成验证后，再回到小程序重试。",
    confirmText: "已验证，重试",
    cancelText: "稍后再说",
    success: result => {
      if (result.confirm && typeof onRetry === "function") onRetry();
    }
  });
}

Page({
  data: {
    viewMode: "today",
    loading: true,
    syncing: false,
    authRequired: false,
    error: "",
    notice: "",
    dateText: "",
    weekdayText: "",
    weekText: "",
    weekTypeText: "",
    hasTimetable: false,
    hasTodayCourses: false,
    sections: defaultSections(),
    weekDays: []
  },

  onShow() {
    this._timetablePageActive = true;
    this._syncPollAttempts = 0;
    if (!wx.getStorageSync("token") && wx.getStorageSync(MANUAL_LOGOUT_KEY)) {
      this.resetLoggedOutState();
      return;
    }
    this.loadCurrent();
  },

  resetLoggedOutState() {
    this.stopSyncPolling();
    this.setData({
      loading: false,
      syncing: false,
      authRequired: true,
      error: "",
      notice: "",
      dateText: "",
      weekdayText: "",
      weekText: "",
      weekTypeText: "",
      hasTimetable: false,
      hasTodayCourses: false,
      sections: defaultSections(),
      weekDays: []
    });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/index" });
  },

  onHide() {
    this._timetablePageActive = false;
    this.stopSyncPolling();
  },

  onUnload() {
    this._timetablePageActive = false;
    this.stopSyncPolling();
  },

  onPullDownRefresh() {
    this.loadCurrent().then(() => wx.stopPullDownRefresh());
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.mode === "week" ? "week" : "today";
    if (mode === this.data.viewMode) return;
    this.stopSyncPolling();
    this._syncPollAttempts = 0;
    this.setData({ viewMode: mode, error: "", notice: "" });
    this.loadCurrent();
  },

  loadCurrent(options) {
    return this.data.viewMode === "week" ? this.loadWeek(options) : this.loadToday(options);
  },

  applyToday(data) {
    const sections = normalizeSections(data.sections);
    const hasTodayCourses = sections.some(section => section.courses.length > 0);
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: WEEKDAY_NAMES[data.weekday] || "",
      weekText: data.isTeachingPeriod === false
        ? (data.academicStatusText || "非教学周")
        : ("第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周"),
      weekTypeText: normalizeWeekType(data),
      hasTimetable: Boolean(data.hasTimetable),
      hasTodayCourses,
      authRequired: false,
      syncing: Boolean(data.syncing),
      notice: data.reviewDemo ? "当前为审核演示课表，不包含真实个人信息" : (data.syncing ? "正在同步课表..." : (data.isTeachingPeriod === false
        ? (data.message || data.academicStatusText || "当前为非教学周")
        : (data.warning ? (data.message || "教务系统暂时不可用，当前显示上次同步课表") : ""))),
      sections
    });
  },

  applyWeek(data) {
    const weekDays = (Array.isArray(data.days) ? data.days : []).map(day => {
      const sections = normalizeSections(day.sections);
      return {
        weekday: day.weekday,
        weekdayText: WEEKDAY_NAMES[day.weekday] || "",
        sections,
        courseSections: sections.filter(section => section.courses.length > 0),
        hasCourses: sections.some(section => section.courses.length > 0)
      };
    });
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: "",
      weekText: data.isTeachingPeriod === false
        ? (data.academicStatusText || "非教学周")
        : ("第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周"),
      weekTypeText: normalizeWeekType(data),
      hasTimetable: Boolean(data.hasTimetable),
      hasTodayCourses: weekDays.some(day => day.hasCourses),
      authRequired: false,
      syncing: Boolean(data.syncing),
      notice: data.reviewDemo ? "当前为审核演示课表，不包含真实个人信息" : (data.syncing ? "正在同步课表..." : (data.isTeachingPeriod === false
        ? (data.message || data.academicStatusText || "当前为非教学周")
        : (data.warning ? (data.message || "教务系统暂时不可用，当前显示上次同步课表") : ""))),
      weekDays
    });
  },

  stopSyncPolling() {
    if (this._syncPollTimer) {
      clearTimeout(this._syncPollTimer);
      this._syncPollTimer = null;
    }
  },

  scheduleSyncPolling() {
    this.stopSyncPolling();
    if (!this._timetablePageActive) return;
    this._syncPollAttempts = Number(this._syncPollAttempts || 0) + 1;
    if (this._syncPollAttempts > 40) {
      this.setData({ syncing: false, notice: "课表同步时间较长，请稍后下拉刷新" });
      return;
    }
    const delay = this._syncPollAttempts <= 5 ? 1200 : 2500;
    this._syncPollTimer = setTimeout(() => {
      this._syncPollTimer = null;
      if (this._timetablePageActive) this.loadCurrent({ polling: true });
    }, delay);
  },

  async loadToday(options) {
    const polling = Boolean(options && options.polling);
    if (!polling && !this.data.hasTimetable) this.setData({ loading: true, error: "" });
    try {
      const data = await api.request("/timetable/today");
      this.applyToday(data || {});
      this.setData({
        loading: false,
        error: data && !data.hasTimetable && !data.syncing ? (data.message || "") : ""
      });
      if (data && data.syncing) this.scheduleSyncPolling();
      else this.stopSyncPolling();
    } catch (err) {
      this.stopSyncPolling();
      if (err && (err.code === "AUTH_REQUIRED" || err.message === "MANUAL_LOGOUT" || err.message === "UNAUTHORIZED")) {
        this.resetLoggedOutState();
        return;
      }
      this.setData({
        loading: false,
        syncing: false,
        error: (err && (err.message || err.errMsg)) || "课表加载失败"
      });
    }
  },

  async loadWeek(options) {
    const polling = Boolean(options && options.polling);
    if (!polling && !this.data.hasTimetable) this.setData({ loading: true, error: "" });
    try {
      const data = await api.request("/timetable/week");
      this.applyWeek(data || {});
      this.setData({
        loading: false,
        error: data && !data.hasTimetable && !data.syncing ? (data.message || "") : ""
      });
      if (data && data.syncing) this.scheduleSyncPolling();
      else this.stopSyncPolling();
    } catch (err) {
      this.stopSyncPolling();
      if (err && (err.code === "AUTH_REQUIRED" || err.message === "MANUAL_LOGOUT" || err.message === "UNAUTHORIZED")) {
        this.resetLoggedOutState();
        return;
      }
      this.setData({
        loading: false,
        syncing: false,
        error: (err && (err.message || err.errMsg)) || "课表加载失败"
      });
    }
  },

  async syncTimetable() {
    if (this.data.authRequired) {
      this.goLogin();
      return;
    }
    this.setData({ syncing: true, error: "", notice: "" });
    try {
      const result = await api.post("/timetable/sync", {}, { timeout: 120000 });
      if (result && result.syncing) {
        this.setData({
          syncing: true,
          notice: result.message || "正在后台刷新课表，完成后会自动更新",
          error: ""
        });
        wx.showToast({ title: "已开始后台刷新", icon: "none" });
        this.scheduleSyncPolling();
        return;
      }
      this.setData({ syncing: false });

      if (result && result.success === false) {
        if (isCaptchaRequired(result)) {
          showCaptchaRequired(() => this.syncTimetable());
          await this.loadCurrent();
          return;
        }

        await this.loadCurrent();
        const hasCache = Boolean(result.hasCache || this.data.hasTimetable);
        const message = result.message || (hasCache
          ? "教务系统暂时不可用，当前显示上次同步课表"
          : "暂无课表，请先刷新课表");
        this.setData({
          notice: hasCache ? message : "",
          error: hasCache ? "" : message
        });
        if (!hasCache) wx.showToast({ title: message, icon: "none" });
        return;
      }

      wx.showToast({ title: "课表已刷新", icon: "success" });
      await this.loadCurrent();
      if (result && (result.syncedCount === 0 || result.count === 0)) {
        wx.showModal({
          title: "未发现课表",
          content: "教务系统返回了空课表，请确认本学期是否已开放课表。",
          showCancel: false
        });
      }
    } catch (err) {
      const message = formatJwxtErrorMessage(err, "课表刷新失败");
      this.setData({
        syncing: false,
        notice: this.data.hasTimetable ? "教务系统暂时不可用，当前显示上次同步课表" : "",
        error: this.data.hasTimetable ? "" : message
      });
      if (isCaptchaRequired(err)) {
        showCaptchaRequired(() => this.syncTimetable());
        return;
      }
      if (isLoginRequired(err)) {
        wx.showModal({
          title: "请先绑定",
          content: "请先绑定教务账号",
          showCancel: false
        });
        return;
      }
      if (!this.data.hasTimetable) wx.showToast({ title: message, icon: "none" });
    }
  }
});
