const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired } = require("../../utils/jwxtError");
const { gradesPresentation, campusPresentation, userErrorMessage } = require("../../utils/statusPresenter");
const { presentGrades } = require("../../utils/gradesPresenter");

Page({
  data: {
    grades: [], groupedGrades: [], termLabels: [], currentGroup: null, currentGrades: [],
    activeTermIndex: 0, count: 0, emptyState: "NO_DATA", isInitialLoading: true,
    refreshing: false, syncing: false, refreshStage: "", refreshError: "",
    refreshButtonText: "刷新成绩", lastSuccessAtText: "", authRequired: false,
    error: null, notice: "", productState: "NO_DATA", statusTitle: "还没有同步成绩",
    statusDescription: "完成校园账号验证后即可同步。", statusLevel: "muted",
    accountState: "UNKNOWN", accountNotice: "", accountActionText: ""
  },

  onShow() {
    this._gradesPageActive = true;
    this._syncPollAttempts = 0;
    if (!wx.getStorageSync("token")) return this.resetLoggedOutState();
    this.loadGrades();
    this.refreshAccountStatus();
  },

  resetLoggedOutState() {
    this.stopSyncPolling();
    this.setData({
      grades: [], groupedGrades: [], termLabels: [], currentGroup: null, currentGrades: [],
      activeTermIndex: 0, count: 0, emptyState: "NO_DATA", isInitialLoading: false,
      refreshing: false, syncing: false, authRequired: true, error: "请先登录后查看成绩",
      notice: "", productState: "NO_DATA", statusTitle: "登录后可同步成绩",
      statusDescription: "微信登录与校园账号验证是两个独立步骤。", statusLevel: "muted",
      accountState: "UNBOUND", accountNotice: "", accountActionText: ""
    });
  },

  goLogin() {
    wx.setStorageSync("loginRedirectIntent", "grades");
    wx.navigateTo({ url: "/pages/login/index" });
  },

  manageCampusAccount() { wx.navigateTo({ url: "/pages/settings/settings" }); },

  refreshAccountStatus() {
    return api.request("/status", { timeout: 10000 }).then(status => {
      const display = campusPresentation(Object.assign({}, status || {}, {
        account: status && status.productStatus && status.productStatus.account
      }));
      const needsAttention = ["UNBOUND", "RELOGIN_REQUIRED", "CAPTCHA_REQUIRED", "SCHOOL_UNAVAILABLE"].includes(display.state);
      this.setData({
        accountState: display.state,
        accountNotice: needsAttention ? display.title + (display.description ? "，" + display.description : "") : "",
        accountActionText: ["UNBOUND", "RELOGIN_REQUIRED", "CAPTCHA_REQUIRED"].includes(display.state) ? display.actionText : ""
      });
    }).catch(() => {});
  },

  onHide() { this._gradesPageActive = false; this.stopSyncPolling(); this.stopRefreshStageTimer(); },
  onUnload() { this._gradesPageActive = false; this.stopSyncPolling(); this.stopRefreshStageTimer(); },

  onPullDownRefresh() {
    if (!wx.getStorageSync("token")) {
      this.resetLoggedOutState();
      wx.stopPullDownRefresh();
      return;
    }
    this.refreshGrades().finally(() => wx.stopPullDownRefresh());
  },

  stopSyncPolling() {
    if (this._syncPollTimer) clearTimeout(this._syncPollTimer);
    this._syncPollTimer = null;
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
      if (!this._gradesPageActive) return;
      const seconds = (Date.now() - this._refreshStartedAt) / 1000;
      this.setData({ refreshStage: seconds < 5 ? "正在连接教务系统" :
        (seconds < 15 ? "学校系统响应较慢，正在继续等待" : "学校系统响应较慢，可以先浏览其他页面，完成后会自动更新") });
    };
    update();
    this._refreshStageTimer = setInterval(update, 1000);
  },

  scheduleSyncPolling() {
    this.stopSyncPolling();
    if (!this._gradesPageActive) return;
    this._syncPollAttempts = Number(this._syncPollAttempts || 0) + 1;
    if (this._syncPollAttempts > 40) {
      this.setData({ syncing: false, refreshing: false, notice: "成绩同步时间较长，请稍后下拉刷新" });
      return;
    }
    const delay = this._syncPollAttempts <= 5 ? 1200 : 2500;
    this._syncPollTimer = setTimeout(() => {
      this._syncPollTimer = null;
      if (this._gradesPageActive) this.loadGrades({ polling: true });
    }, delay);
  },

  loadGrades(options) {
    const polling = Boolean(options && options.polling);
    if (!polling && !this.data.grades.length) this.setData({ isInitialLoading: true, error: null });
    return api.request("/grades").then(data => {
      const selectedKey = this.data.currentGroup && this.data.currentGroup.key;
      const view = presentGrades(data, selectedKey);
      const grades = view.grades;
      const syncing = Boolean(data.syncing);
      const display = gradesPresentation(Object.assign({}, data, { hasGrades: view.totalCount > 0 }));
      const keepVisibleGrades = syncing && !grades.length && this.data.grades.length;
      if (keepVisibleGrades) {
        this.setData({ syncing: true, refreshing: true, isInitialLoading: false,
          notice: "正在更新成绩，当前显示上次同步结果", productState: "SYNCING",
          statusTitle: "正在同步成绩", statusDescription: "当前继续显示上次同步的数据。", statusLevel: "muted", error: null });
        this.scheduleSyncPolling();
        return;
      }
      this.setData(Object.assign({}, view, {
        count: data.count || view.totalCount, syncing, authRequired: false, refreshing: syncing,
        refreshButtonText: syncing ? "正在更新" : "刷新成绩",
        lastSuccessAtText: display.updatedAtText || this.data.lastSuccessAtText,
        productState: display.state, statusTitle: display.title, statusDescription: display.description,
        statusLevel: display.level, notice: data.reviewDemo ? "当前为审核演示数据，不包含真实个人信息" :
          (display.state === "READY" ? "" : display.title + (display.description ? "，" + display.description : "")),
        error: display.state === "SYNC_FAILED_NO_CACHE" ? display.description : null, isInitialLoading: false
      }));
      if (syncing) {
        this.setData({ notice: view.totalCount ? "正在后台刷新成绩，当前显示上次结果" : "正在同步成绩...", error: null });
        this.scheduleSyncPolling();
      } else {
        this.stopSyncPolling();
        this.stopRefreshStageTimer();
      }
    }).catch(err => {
      const hasCache = this.data.grades && this.data.grades.length;
      this.setData({ notice: hasCache ? "教务系统暂时不可用，当前显示上次查询成绩" : "",
        productState: hasCache ? "SYNC_FAILED_WITH_CACHE" : "SYNC_FAILED_NO_CACHE",
        statusTitle: hasCache ? "暂时无法同步最新成绩" : "暂时无法同步成绩",
        statusDescription: hasCache ? "当前显示的是上次同步的数据。" : userErrorMessage(err, "学校系统暂时无法访问，请稍后再试。"),
        statusLevel: hasCache ? "warn" : "err", error: hasCache ? null : userErrorMessage(err, "暂时无法同步成绩，请稍后再试"),
        isInitialLoading: false, refreshing: false, syncing: false, refreshButtonText: "刷新成绩",
        refreshError: formatJwxtErrorMessage(err, "成绩加载失败") });
    });
  },

  async refreshGrades() {
    if (!wx.getStorageSync("token")) { this.resetLoggedOutState(); this.goLogin(); return; }
    if (this.data.refreshing || this.data.syncing) {
      wx.showToast({ title: "成绩正在更新，请稍候", icon: "none" });
      return;
    }
    this.stopSyncPolling();
    this._syncPollAttempts = 0;
    this.setData({ refreshing: true, syncing: true, refreshButtonText: "正在更新", refreshStage: "正在连接教务系统",
      refreshError: "", notice: this.data.grades.length ? "正在更新成绩，当前显示上次同步结果" : "正在获取首次成绩数据", error: null });
    this.startRefreshStageTimer();
    try {
      const result = await api.post("/check", {}, { timeout: 120000 });
      if (result && result.syncing) {
        this.setData({ syncing: true, notice: result.message || "正在后台刷新成绩，完成后会自动更新", error: null });
        wx.showToast({ title: "已开始后台刷新", icon: "none" });
        this.scheduleSyncPolling();
        return;
      }
      if (result && result.checked === false) {
        if (isCaptchaRequired(result)) wx.showModal({ title: "需要重新验证", content: "教务系统需要验证码或重新登录，请完成登录后再刷新成绩。", showCancel: false });
        else wx.showToast({ title: "暂时无法同步成绩，请稍后再试", icon: "none" });
      } else {
        this.setData({ refreshButtonText: "更新完成" });
        wx.showToast({ title: "成绩已刷新", icon: "success" });
      }
      await this.loadGrades();
      this.refreshAccountStatus();
    } catch (err) {
      const message = formatJwxtErrorMessage(err, "成绩同步失败，请稍后再试");
      this.setData({ syncing: false, refreshError: this.data.grades.length ? message + "，当前继续显示上次同步结果" : message,
        error: this.data.grades.length ? null : "暂时无法同步成绩，请稍后再试" });
      wx.showToast({ title: "暂时无法同步成绩，请稍后再试", icon: "none" });
    } finally {
      this.stopRefreshStageTimer();
      if (!this.data.syncing) {
        const completed = this.data.refreshButtonText === "更新完成";
        this.setData({ refreshing: false });
        setTimeout(() => { if (this._gradesPageActive && !this.data.syncing) this.setData({ refreshButtonText: "刷新成绩", refreshStage: "" }); }, completed ? 1200 : 0);
      }
    }
  },

  selectTerm(e) {
    const index = Number(e.detail.value || 0);
    const currentGroup = this.data.groupedGrades[index] || null;
    this.setData({ activeTermIndex: index, currentGroup, currentGrades: currentGroup ? currentGroup.grades : [],
      emptyState: !this.data.count ? "NO_DATA" : (currentGroup && !currentGroup.grades.length ? "EMPTY_TERM" : "HAS_DATA") });
  }
});
