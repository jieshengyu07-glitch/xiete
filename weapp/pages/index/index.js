Page({
  onLoad() {
    this.openTimetable();
  },

  onShow() {
    this.openTimetable();
  },

  openTimetable() {
    if (this._redirecting) return;
    this._redirecting = true;
    wx.switchTab({
      url: "/pages/timetable/timetable",
      fail: () => {
        this._redirecting = false;
        wx.reLaunch({ url: "/pages/timetable/timetable" });
      }
    });
  }
});
