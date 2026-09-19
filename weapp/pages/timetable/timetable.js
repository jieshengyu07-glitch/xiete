const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired, isLoginRequired } = require("../../utils/jwxtError");
const { timetablePresentation, campusPresentation, userErrorMessage } = require("../../utils/statusPresenter");
const { SECTION_NUMBERS, coursesFromSections, resolveCourseTimeline } = require("../../utils/timetableTimeline");
const announcementService = require("../../utils/announcement");
const timetableCache = require("../../utils/timetableCache");

const WEEKDAY_NAMES = ["", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const TIMETABLE_FRESHNESS_MS = 8000;
function defaultSections() {
  return SECTION_NUMBERS.map(section => ({
    section,
    title: "第" + section + "大节",
    timeText: "",
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

function campusName(code) {
  return code === "WANBAILIN" ? "万柏林校区" : (code === "JINYUAN" ? "晋源校区" : "");
}

function normalizeSections(sections, classPeriods) {
  const source = Array.isArray(sections) ? sections : [];
  const times = {};
  (Array.isArray(classPeriods) ? classPeriods : []).forEach(item => {
    if (item && item.section && item.startTime && item.endTime) times[Number(item.section)] = item.startTime + "—" + item.endTime;
  });
  return defaultSections().map(fallback => {
    const matches = source.filter(item => Number(item && item.section) === fallback.section);
    const item = matches[0] || fallback;
    const courses = matches.reduce((list, match) => {
      return list.concat(Array.isArray(match.courses) ? match.courses : []);
    }, []);
    return {
      ...item,
      section: fallback.section,
      title: item.title || fallback.title,
      timeText: item.timeText || times[fallback.section] || fallback.timeText,
      courses
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
    isInitialLoading: true,
    initialLoadingText: "加载中...",
    backgroundRefreshing: false,
    syncing: false,
    refreshStage: "",
    refreshButtonText: "刷新课表",
    authRequired: false,
    error: "",
    notice: "",
    productState: "NO_DATA",
    statusTitle: "还没有同步课表",
    statusDescription: "完成校园账号验证后即可同步。",
    statusLevel: "muted",
    academicIdle: false,
    classPeriods: [],
    classTimeSchoolVerified: false,
    defaultCampusCode: "",
    campusName: "",
    showCampusChooser: false,
    campusSaving: false,
    timelineState: "NO_CLASS_TODAY",
    timelineTitle: "今天没有课",
    timelineDescription: "",
    focusCourse: null,
    todayCourses: [],
    todayCourseCount: 0,
    remainingCourseCount: 0,
    accountState: "UNKNOWN",
    accountNotice: "",
    accountNoticeTitle: "",
    accountNoticeDescription: "",
    accountActionText: "",
    dateText: "",
    weekdayText: "",
    weekText: "",
    weekTypeText: "",
    hasTimetable: false,
    hasTodayCourses: false,
    hasWeekCourses: false,
    todayEmptyTitle: "今天没有课",
    todayEmptyDescription: "暂无课程安排",
    sections: defaultSections(),
    weekDays: [],
    announcement: null,
    showAnnouncementBanner: false,
    announcementVisible: false
  },

  onShow() {
    this._timetablePageActive = true;
    this._syncPollAttempts = 0;
    this.loadAnnouncement();
    if (!wx.getStorageSync("token")) {
      this.resetLoggedOutState();
      return;
    }
    const cacheApplied = this.loadCachedCurrent();
    this.loadCurrent({ backgroundRefresh: cacheApplied });
    this.refreshAccountStatus();
  },

  loadAnnouncement() {
    announcementService.loadAnnouncement({ allowAutoPopup: true })
      .then(result => {
        const item = result.announcement;
        this.setData({
          announcement: item,
          showAnnouncementBanner: Boolean(item && item.enabled),
          announcementVisible: Boolean(result.shouldAutoOpen)
        });
      })
      .catch(() => {
        this.setData({ showAnnouncementBanner: false, announcementVisible: false });
      });
  },

  openAnnouncement() {
    if (this.data.announcement && this.data.announcement.enabled) {
      this.setData({ announcementVisible: true });
    }
  },

  closeAnnouncement() {
    announcementService.dismissAnnouncement(this.data.announcement);
    this.setData({ announcementVisible: false });
  },

  resetLoggedOutState() {
    this.stopSyncPolling();
    this.stopInitialConnectionTimer();
    this.setData({
      isInitialLoading: false,
      initialLoadingText: "加载中...",
      backgroundRefreshing: false,
      syncing: false,
      authRequired: true,
      error: "",
      notice: "",
      productState: "NO_DATA",
      statusTitle: "登录后可同步课表",
      statusDescription: "微信登录与校园账号验证是两个独立步骤。",
      statusLevel: "muted",
      academicIdle: false,
      defaultCampusCode: "",
      campusName: "",
      showCampusChooser: false,
      campusSaving: false,
      timelineState: "NO_CLASS_TODAY",
      timelineTitle: "登录后查看课表",
      timelineDescription: "完成登录后即可查看今天的课程安排。",
      focusCourse: null,
      todayCourses: [],
      todayCourseCount: 0,
      remainingCourseCount: 0,
      accountState: "UNBOUND",
      accountNotice: "",
      accountNoticeTitle: "",
      accountNoticeDescription: "",
      accountActionText: "",
      dateText: "",
      weekdayText: "",
      weekText: "",
      weekTypeText: "",
      hasTimetable: false,
      hasTodayCourses: false,
      hasWeekCourses: false,
      todayEmptyTitle: "登录后查看课表",
      todayEmptyDescription: "完成登录后即可查看今天的课程安排。",
      sections: defaultSections(),
      weekDays: []
    });
  },

  goLogin() {
    wx.setStorageSync("loginRedirectIntent", "timetable");
    wx.navigateTo({ url: "/pages/login/index" });
  },

  manageCampusAccount() {
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  refreshAccountStatus() {
    return api.request("/status", { timeout: 10000 }).then(status => {
      const display = campusPresentation(Object.assign({}, status || {}, {
        account: status && status.productStatus && status.productStatus.account
      }));
      const needsAttention = ["UNBOUND", "RELOGIN_REQUIRED", "CAPTCHA_REQUIRED", "SCHOOL_UNAVAILABLE"].includes(display.state);
      const title = display.state === "UNBOUND" ? "尚未绑定校园账号" : display.title;
      const description = display.state === "UNBOUND" ? "绑定后即可同步最新课表和成绩。" : display.description;
      this.setData({
        accountState: display.state,
        accountNotice: needsAttention ? title + (description ? "，" + description : "") : "",
        accountNoticeTitle: needsAttention ? title : "",
        accountNoticeDescription: needsAttention ? description : "",
        accountActionText: ["UNBOUND", "RELOGIN_REQUIRED", "CAPTCHA_REQUIRED"].includes(display.state) ? display.actionText : ""
      });
    }).catch(() => {});
  },

  onHide() {
    this._timetablePageActive = false;
    this.stopSyncPolling();
    this.stopRefreshStageTimer();
    this.stopInitialConnectionTimer();
  },

  onUnload() {
    this._timetablePageActive = false;
    this.stopSyncPolling();
    this.stopRefreshStageTimer();
    this.stopInitialConnectionTimer();
  },

  onPullDownRefresh() {
    if (!wx.getStorageSync("token")) {
      this.resetLoggedOutState();
      wx.stopPullDownRefresh();
      return;
    }
    Promise.all([this.loadCurrent({ force: true }), this.refreshAccountStatus()]).finally(() => wx.stopPullDownRefresh());
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.mode === "week" ? "week" : "today";
    if (mode === this.data.viewMode) return;
    this.stopSyncPolling();
    this._syncPollAttempts = 0;
    this.setData({ viewMode: mode, error: "", notice: "" });
    const cacheApplied = this.loadCachedCurrent();
    this.loadCurrent({ backgroundRefresh: cacheApplied });
  },

  loadCurrent(options) {
    return this.data.viewMode === "week" ? this.loadWeek(options) : this.loadToday(options);
  },

  loadCachedCurrent() {
    return this.data.viewMode === "week" ? this.loadCachedWeek() : this.loadCachedToday();
  },

  loadCachedToday() {
    return this.applyCachedView("today");
  },

  loadCachedWeek() {
    return this.applyCachedView("week");
  },

  applyCachedView(viewType) {
    const cached = timetableCache.read(viewType);
    if (!cached) return false;
    try {
      if (viewType === "week") this.applyWeek(cached.payload);
      else this.applyToday(cached.payload);
      this._localTimetableCache = this._localTimetableCache || {};
      this._localTimetableCache[viewType] = true;
      this.setData({
        isInitialLoading: false,
        initialLoadingText: "加载中...",
        backgroundRefreshing: false,
        error: ""
      });
      return true;
    } catch (_) {
      return false;
    }
  },

  hasLocalCache(viewType) {
    return Boolean(this._localTimetableCache && this._localTimetableCache[viewType]);
  },

  wasRecentlyRefreshed(viewType) {
    const at = this._lastTimetableRefreshAt && this._lastTimetableRefreshAt[viewType];
    return Boolean(at && Date.now() - at < TIMETABLE_FRESHNESS_MS);
  },

  markRefreshed(viewType) {
    this._lastTimetableRefreshAt = this._lastTimetableRefreshAt || {};
    this._lastTimetableRefreshAt[viewType] = Date.now();
  },

  stopInitialConnectionTimer() {
    if (this._initialConnectionTimer) clearTimeout(this._initialConnectionTimer);
    this._initialConnectionTimer = null;
  },

  startInitialConnectionTimer() {
    this.stopInitialConnectionTimer();
    this._initialConnectionTimer = setTimeout(() => {
      this._initialConnectionTimer = null;
      if (this._timetablePageActive && this.data.isInitialLoading && !this.data.hasTimetable) {
        this.setData({ initialLoadingText: "正在连接服务..." });
      }
    }, 2500);
  },

  applyToday(data) {
    this._lastTodayData = Object.assign({}, data || {});
    const classPeriods = Array.isArray(data.classPeriods) ? data.classPeriods : this.data.classPeriods;
    const defaultCampusCode = String(data.defaultCampusCode || data.campusCode || "");
    const sections = normalizeSections(data.sections, classPeriods);
    const hasTodayCourses = sections.some(section => section.courses.length > 0);
    const display = timetablePresentation(data);
    const academicIdle = ["PRE_TERM", "VACATION", "BETWEEN_TERMS"].includes(display.state);
    const timeline = resolveCourseTimeline({ sections, classPeriods, termStatus: data.termStatus });
    const timelineDescription = timeline.state === "PRE_TERM" && data.teachingWeekStartDate
      ? "预计 " + displayDate(data.teachingWeekStartDate) + " 进入教学周。"
      : timeline.description;
    const emptyByState = {
      PRE_TERM: ["新学期尚未开始", "暂无今日课程"],
      VACATION: ["当前处于假期", "暂无课程安排"],
      BETWEEN_TERMS: ["当前处于学期间隔", "暂无课程安排"],
      NO_CLASS_TODAY: ["今天没有课", "暂无课程安排"],
      AFTER_LAST_CLASS: ["今天的课上完了", "今天的课程仍可在上方查看"]
    };
    const emptyContent = emptyByState[timeline.state] || [timeline.title || "今天没有课", "暂无课程安排"];
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: WEEKDAY_NAMES[data.weekday] || "",
      weekText: data.isTeachingPeriod === false
        ? (data.academicStatusText || "非教学周")
        : ("第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周"),
      weekTypeText: normalizeWeekType(data),
      hasTimetable: Boolean(data.hasTimetable),
      hasTodayCourses,
      hasWeekCourses: false,
      authRequired: false,
      syncing: Boolean(data.syncing),
      refreshButtonText: data.syncing ? "正在更新" : "刷新课表",
      productState: display.state,
      statusTitle: display.title,
      statusDescription: display.description,
      statusLevel: display.level,
      academicIdle,
      classPeriods,
      classTimeSchoolVerified: data.classTimeSchoolVerified === true,
      defaultCampusCode,
      campusName: campusName(defaultCampusCode),
      showCampusChooser: !defaultCampusCode,
      timelineState: timeline.state,
      timelineTitle: timeline.title,
      timelineDescription,
      todayEmptyTitle: emptyContent[0],
      todayEmptyDescription: emptyContent[1],
      focusCourse: timeline.focusCourse || null,
      todayCourses: timeline.courses,
      todayCourseCount: timeline.totalCourses,
      remainingCourseCount: timeline.remainingCourses,
      notice: data.reviewDemo ? "当前为审核演示课表，不包含真实个人信息" :
        (display.state === "SYNCING" && !data.hasTimetable ? "正在同步课表..." :
          (["READY"].includes(display.state) ? "" : display.title + (display.description ? "，" + display.description : ""))),
      sections
    });
  },

  applyWeek(data) {
    this._lastWeekData = Object.assign({}, data || {});
    const classPeriods = Array.isArray(data.classPeriods) ? data.classPeriods : this.data.classPeriods;
    const defaultCampusCode = String(data.defaultCampusCode || data.campusCode || "");
    const weekDays = (Array.isArray(data.days) ? data.days : []).map(day => {
      const sections = normalizeSections(day.sections, classPeriods).map(section => Object.assign({}, section, {
        courses: coursesFromSections([section], classPeriods)
      }));
      return {
        weekday: day.weekday,
        weekdayText: WEEKDAY_NAMES[day.weekday] || "",
        isToday: Number(day.weekday) === Number(data.weekday),
        sections,
        hasCourses: sections.some(section => section.courses.length > 0)
      };
    });
    const display = timetablePresentation(data);
    const academicIdle = ["PRE_TERM", "VACATION", "BETWEEN_TERMS"].includes(display.state);
    const hasWeekCourses = weekDays.some(day => day.hasCourses);
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: "",
      weekText: data.isTeachingPeriod === false
        ? (data.academicStatusText || "非教学周")
        : ("第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周"),
      weekTypeText: normalizeWeekType(data),
      hasTimetable: Boolean(data.hasTimetable),
      hasTodayCourses: hasWeekCourses,
      hasWeekCourses,
      authRequired: false,
      syncing: Boolean(data.syncing),
      refreshButtonText: data.syncing ? "正在更新" : "刷新课表",
      productState: display.state,
      statusTitle: display.title,
      statusDescription: display.description,
      statusLevel: display.level,
      academicIdle,
      timelineState: academicIdle ? display.state : this.data.timelineState,
      timelineTitle: academicIdle ? display.title : this.data.timelineTitle,
      classPeriods,
      classTimeSchoolVerified: data.classTimeSchoolVerified === true,
      defaultCampusCode,
      campusName: campusName(defaultCampusCode),
      showCampusChooser: !defaultCampusCode,
      notice: data.reviewDemo ? "当前为审核演示课表，不包含真实个人信息" :
        (display.state === "SYNCING" && !data.hasTimetable ? "正在同步课表..." :
          (["READY"].includes(display.state) ? "" : display.title + (display.description ? "，" + display.description : ""))),
      weekDays
    });
  },

  async selectCampus(e) {
    if (this.data.campusSaving) return;
    const defaultCampusCode = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.campusCode || "");
    if (!["WANBAILIN", "JINYUAN"].includes(defaultCampusCode)) return;
    const previous = this.data.viewMode === "week" ? this._lastWeekData : this._lastTodayData;
    this.setData({ campusSaving: true });
    try {
      const config = await api.post("/preferences/campus", {
        defaultCampusCode,
        date: previous && previous.date || ""
      });
      const next = Object.assign({}, previous || {}, config || {}, {
        defaultCampusCode,
        campusCode: defaultCampusCode
      });
      if (previous) {
        if (this.data.viewMode === "week") this.applyWeek(next);
        else this.applyToday(next);
      } else {
        this.setData({
          defaultCampusCode,
          campusName: campusName(defaultCampusCode),
          classPeriods: Array.isArray(config && config.classPeriods) ? config.classPeriods : this.data.classPeriods,
          showCampusChooser: false
        });
      }
      timetableCache.updateCampusPreference(defaultCampusCode, config && config.classPeriods);
      if (previous) timetableCache.write(this.data.viewMode, next);
      wx.showToast({ title: "校区已保存", icon: "success" });
    } catch (err) {
      wx.showToast({ title: "校区保存失败，请重试", icon: "none" });
    } finally {
      this.setData({ campusSaving: false });
    }
  },

  stopSyncPolling() {
    if (this._syncPollTimer) {
      clearTimeout(this._syncPollTimer);
      this._syncPollTimer = null;
    }
  },

  stopRefreshStageTimer() {
    if (this._refreshStageTimer) clearInterval(this._refreshStageTimer);
    this._refreshStageTimer = null;
    this._refreshStartedAt = 0;
  },

  startRefreshStageTimer() {
    this.stopRefreshStageTimer();
    this._refreshStartedAt = Date.now();
    const update = () => {
      if (!this._timetablePageActive) return;
      const seconds = (Date.now() - this._refreshStartedAt) / 1000;
      this.setData({ refreshStage: seconds < 5 ? "正在连接教务系统" : (seconds < 15
        ? "学校系统响应较慢，正在继续等待"
        : "学校系统响应较慢，可以先浏览其他页面，完成后会自动更新") });
    };
    update();
    this._refreshStageTimer = setInterval(update, 1000);
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

  loadToday(options) {
    const config = options || {};
    this._timetableLoadPromises = this._timetableLoadPromises || {};
    if (this._timetableLoadPromises.today) return this._timetableLoadPromises.today;
    if (!config.force && !config.polling && this.wasRecentlyRefreshed("today")) return Promise.resolve({ skipped: true });

    const polling = Boolean(options && options.polling);
    const backgroundRefresh = Boolean(config.backgroundRefresh && (this.hasLocalCache("today") || this.data.hasTimetable));
    if (!polling && !backgroundRefresh && !this.data.hasTimetable) {
      this.setData({ isInitialLoading: true, initialLoadingText: "加载中...", error: "" });
      this.startInitialConnectionTimer();
    } else if (backgroundRefresh) {
      this.setData({ backgroundRefreshing: true, notice: "正在更新课表..." });
    }

    const task = (async () => {
      try {
        const data = await api.request("/timetable/today");
        if (!timetableCache.validPayload("today", data)) throw new Error("INVALID_TIMETABLE_PAYLOAD");
        timetableCache.write("today", data);
        this._localTimetableCache = this._localTimetableCache || {};
        this._localTimetableCache.today = true;
        this.markRefreshed("today");
        if (this.data.viewMode === "today") {
          this.applyToday(data);
          this.setData({
            isInitialLoading: false,
            initialLoadingText: "加载中...",
            backgroundRefreshing: false,
            error: this.data.productState === "SYNC_FAILED_NO_CACHE" ? this.data.statusDescription : ""
          });
        }
        if (data.syncing) this.scheduleSyncPolling();
        else this.stopSyncPolling();
        return data;
      } catch (err) {
        this.stopSyncPolling();
        if (err && (err.code === "AUTH_REQUIRED" || err.message === "MANUAL_LOGOUT" || err.message === "UNAUTHORIZED")) {
          this.resetLoggedOutState();
          return null;
        }
        const hasCache = this.hasLocalCache("today") || this.data.hasTimetable;
        if (this.data.viewMode === "today") {
          this.setData({
            isInitialLoading: false,
            backgroundRefreshing: false,
            syncing: false,
            productState: hasCache ? "SYNC_FAILED_WITH_CACHE" : "SYNC_FAILED_NO_CACHE",
            statusTitle: hasCache ? "暂时无法同步最新课表" : "暂时无法同步课表",
            statusDescription: hasCache ? "当前显示的是上次同步的数据。" : userErrorMessage(err, "学校系统暂时无法访问，请稍后再试。"),
            statusLevel: hasCache ? "warn" : "err",
            notice: hasCache ? "当前显示上次课表，可下拉刷新获取最新数据。" : "",
            error: hasCache ? "" : userErrorMessage(err, "课表加载失败，请稍后再试")
          });
        }
        return null;
      } finally {
        this.stopInitialConnectionTimer();
      }
    })();
    this._timetableLoadPromises.today = task;
    task.then(() => {
      if (this._timetableLoadPromises.today === task) this._timetableLoadPromises.today = null;
    }, () => {
      if (this._timetableLoadPromises.today === task) this._timetableLoadPromises.today = null;
    });
    return task;
  },

  loadWeek(options) {
    const config = options || {};
    this._timetableLoadPromises = this._timetableLoadPromises || {};
    if (this._timetableLoadPromises.week) return this._timetableLoadPromises.week;
    if (!config.force && !config.polling && this.wasRecentlyRefreshed("week")) return Promise.resolve({ skipped: true });

    const polling = Boolean(options && options.polling);
    const backgroundRefresh = Boolean(config.backgroundRefresh && (this.hasLocalCache("week") || this.data.hasTimetable));
    if (!polling && !backgroundRefresh && !this.data.hasTimetable) {
      this.setData({ isInitialLoading: true, initialLoadingText: "加载中...", error: "" });
      this.startInitialConnectionTimer();
    } else if (backgroundRefresh) {
      this.setData({ backgroundRefreshing: true, notice: "正在更新课表..." });
    }

    const task = (async () => {
      try {
        const data = await api.request("/timetable/week");
        if (!timetableCache.validPayload("week", data)) throw new Error("INVALID_TIMETABLE_PAYLOAD");
        timetableCache.write("week", data);
        this._localTimetableCache = this._localTimetableCache || {};
        this._localTimetableCache.week = true;
        this.markRefreshed("week");
        if (this.data.viewMode === "week") {
          this.applyWeek(data);
          this.setData({
            isInitialLoading: false,
            initialLoadingText: "加载中...",
            backgroundRefreshing: false,
            error: this.data.productState === "SYNC_FAILED_NO_CACHE" ? this.data.statusDescription : ""
          });
        }
        if (data.syncing) this.scheduleSyncPolling();
        else this.stopSyncPolling();
        return data;
      } catch (err) {
        this.stopSyncPolling();
        if (err && (err.code === "AUTH_REQUIRED" || err.message === "MANUAL_LOGOUT" || err.message === "UNAUTHORIZED")) {
          this.resetLoggedOutState();
          return null;
        }
        const hasCache = this.hasLocalCache("week") || this.data.hasTimetable;
        if (this.data.viewMode === "week") {
          this.setData({
            isInitialLoading: false,
            backgroundRefreshing: false,
            syncing: false,
            productState: hasCache ? "SYNC_FAILED_WITH_CACHE" : "SYNC_FAILED_NO_CACHE",
            statusTitle: hasCache ? "暂时无法同步最新课表" : "暂时无法同步课表",
            statusDescription: hasCache ? "当前显示的是上次同步的数据。" : userErrorMessage(err, "学校系统暂时无法访问，请稍后再试。"),
            statusLevel: hasCache ? "warn" : "err",
            notice: hasCache ? "当前显示上次课表，可下拉刷新获取最新数据。" : "",
            error: hasCache ? "" : userErrorMessage(err, "课表加载失败，请稍后再试")
          });
        }
        return null;
      } finally {
        this.stopInitialConnectionTimer();
      }
    })();
    this._timetableLoadPromises.week = task;
    task.then(() => {
      if (this._timetableLoadPromises.week === task) this._timetableLoadPromises.week = null;
    }, () => {
      if (this._timetableLoadPromises.week === task) this._timetableLoadPromises.week = null;
    });
    return task;
  },

  async syncTimetable() {
    if (this.data.authRequired) {
      this.goLogin();
      return;
    }
    if (this.data.syncing) {
      wx.showToast({ title: "课表正在更新，请稍候", icon: "none" });
      return;
    }
    this.setData({
      syncing: true,
      refreshButtonText: "正在更新",
      refreshStage: "正在连接教务系统",
      error: "",
      notice: this.data.hasTimetable ? "正在更新课表，当前显示上次同步结果" : "正在获取首次课表数据"
    });
    this.startRefreshStageTimer();
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
      this.setData({ syncing: false, refreshButtonText: "更新完成" });

      if (result && result.success === false) {
        if (isCaptchaRequired(result)) {
          showCaptchaRequired(() => this.syncTimetable());
          await this.loadCurrent({ force: true });
          return;
        }

        await Promise.all([this.loadCurrent({ force: true }), this.refreshAccountStatus()]);
        const hasCache = Boolean(result.hasCache || this.data.hasTimetable);
        const message = result.message || (hasCache
          ? "课表刷新失败，已保留原课表"
          : "暂无课表，请先刷新课表");
        this.setData({
          notice: hasCache ? message : "",
          error: hasCache ? "" : message
        });
        if (!hasCache) wx.showToast({ title: message, icon: "none" });
        return;
      }

      wx.showToast({ title: "课表已刷新", icon: "success" });
      await this.loadCurrent({ force: true });
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
        notice: this.data.hasTimetable ? "课表刷新失败，已保留原课表" : "",
        error: this.data.hasTimetable ? "" : message
      });
      if (isCaptchaRequired(err)) {
        showCaptchaRequired(() => this.syncTimetable());
        return;
      }
      if (isLoginRequired(err)) {
        this.setData({
          accountState: "UNBOUND",
          accountNotice: "绑定校园账号后即可同步课表。",
          accountActionText: "绑定校园账号"
        });
        return;
      }
      this.refreshAccountStatus();
      if (!this.data.hasTimetable) wx.showToast({ title: message, icon: "none" });
    } finally {
      if (!this.data.syncing) {
        this.stopRefreshStageTimer();
        const completed = this.data.refreshButtonText === "更新完成";
        setTimeout(() => {
          if (this._timetablePageActive && !this.data.syncing) this.setData({ refreshButtonText: "刷新课表", refreshStage: "" });
        }, completed ? 1200 : 0);
      }
    }
  }
});
