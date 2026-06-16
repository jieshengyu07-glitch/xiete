const api = require("../../utils/api");
Page({
  data: { grades: [], count: 0, loading: true, error: null },
  onShow() { this.loadGrades(); },
  onPullDownRefresh() { this.loadGrades().then(() => wx.stopPullDownRefresh()); },
  loadGrades() {
    this.setData({ loading: true, error: null });
    return api.request("/grades").then(d => {
      this.setData({ grades: d.grades || [], count: d.count || 0, loading: false });
    }).catch(e => {
      this.setData({ error: "连接失败: " + (e.errMsg || e.message), loading: false });
    });
  },
  formatTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2,"0") + "-" + d.getDate().toString().padStart(2,"0") + " " + d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
  }
});
