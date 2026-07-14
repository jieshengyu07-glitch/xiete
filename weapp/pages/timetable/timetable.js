const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired, isLoginRequired } = require("../../utils/jwxtError");

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
    loading: true,
    syncing: false,
    error: "",
    notice: "",
    dateText: "",
    weekdayText: "",
    weekText: "",
    weekTypeText: "",
    hasTimetable: false,
    hasTodayCourses: false,
    sections: defaultSections()
  },

  onShow() {
    this.loadToday();
  },

  onPullDownRefresh() {
    this.loadToday().then(() => wx.stopPullDownRefresh());
  },

  applyToday(data) {
    const sections = normalizeSections(data.sections);
    const hasTodayCourses = sections.some(section => section.courses.length > 0);
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: WEEKDAY_NAMES[data.weekday] || "",
      weekText: "第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周",
      weekTypeText: normalizeWeekType(data),
      hasTimetable: Boolean(data.hasTimetable),
      hasTodayCourses,
      notice: data.warning ? (data.message || "教务系统暂时不可用，当前显示上次同步课表") : "",
      sections
    });
  },

  async loadToday() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.request("/timetable/today");
      this.applyToday(data || {});
      this.setData({
        loading: false,
        error: data && !data.hasTimetable ? (data.message || "") : ""
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: (err && (err.message || err.errMsg)) || "课表加载失败"
      });
    }
  },

  async syncTimetable() {
    this.setData({ syncing: true, error: "", notice: "" });
    wx.showLoading({ title: "刷新课表..." });
    try {
      const result = await api.post("/timetable/sync", {}, { timeout: 120000 });
      wx.hideLoading();
      this.setData({ syncing: false });

      if (result && result.success === false) {
        if (isCaptchaRequired(result)) {
          showCaptchaRequired(() => this.syncTimetable());
          await this.loadToday();
          return;
        }

        await this.loadToday();
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
      await this.loadToday();
      if (result && (result.syncedCount === 0 || result.count === 0)) {
        wx.showModal({
          title: "未发现课表",
          content: "教务系统返回了空课表，请确认本学期是否已开放课表。",
          showCancel: false
        });
      }
    } catch (err) {
      wx.hideLoading();
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
