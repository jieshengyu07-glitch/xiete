const api = require("../../utils/api");

const WEEKDAY_NAMES = ["", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function defaultSections() {
  return [1, 2, 3, 4].map(section => ({
    section,
    title: "第" + section + "大节",
    courses: []
  }));
}

function displayDate(value) {
  if (!value) return "";
  const parts = String(value).split("-");
  if (parts.length !== 3) return value;
  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
}

function showCaptchaRequired() {
  wx.showModal({
    title: "需要验证码",
    content: "教务系统需要验证码验证，请在小程序内完成一次验证。",
    confirmText: "去验证",
    cancelText: "稍后再说",
    success: result => {
      if (result.confirm) wx.switchTab({ url: "/pages/settings/settings" });
    }
  });
}

Page({
  data: {
    loading: true,
    syncing: false,
    error: "",
    dateText: "",
    weekdayText: "",
    weekText: "",
    weekTypeText: "",
    hasTimetable: false,
    sections: defaultSections()
  },

  onShow() {
    this.loadToday();
  },

  onPullDownRefresh() {
    this.loadToday().then(() => wx.stopPullDownRefresh());
  },

  applyToday(data) {
    this.setData({
      dateText: displayDate(data.date),
      weekdayText: WEEKDAY_NAMES[data.weekday] || "",
      weekText: "第" + (data.currentTeachingWeek || data.weekNumber || "-") + "教学周",
      weekTypeText: data.weekTypeText || data.weekTypeName || (data.weekType === "ODD" ? "单周" : "双周"),
      hasTimetable: Boolean(data.hasTimetable),
      sections: data.sections || defaultSections()
    });
  },

  async loadToday() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await api.request("/timetable/today");
      this.applyToday(data || {});
      this.setData({ loading: false });
    } catch (err) {
      this.setData({
        loading: false,
        error: (err && (err.message || err.errMsg)) || "课表加载失败"
      });
    }
  },

  async syncTimetable() {
    this.setData({ syncing: true, error: "" });
    wx.showLoading({ title: "刷新课表..." });
    try {
      const result = await api.post("/timetable/sync", {}, { timeout: 120000 });
      wx.hideLoading();
      this.setData({ syncing: false });

      if (result && result.success === false) {
        if (result.error === "JWXT_CAPTCHA_REQUIRED") {
          showCaptchaRequired();
          await this.loadToday();
          return;
        }
        wx.showModal({
          title: "刷新失败",
          content: result.message || "课表同步失败",
          showCancel: false
        });
        await this.loadToday();
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
      this.setData({
        syncing: false,
        error: (err && (err.message || err.errMsg)) || "课表刷新失败"
      });
      if (err && err.error === "JWXT_CAPTCHA_REQUIRED") {
        showCaptchaRequired();
        return;
      }
      wx.showModal({
        title: "刷新失败",
        content: (err && (err.message || err.errMsg)) || "请先确认已绑定教务账号，并稍后再试。",
        showCancel: false
      });
    }
  }
});
