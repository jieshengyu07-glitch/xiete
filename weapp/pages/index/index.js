const api = require("../../utils/api");
Page({
  data: { status: null, loading: true, error: null },
  onShow() { this.loadStatus(); },
  onPullDownRefresh() { this.loadStatus().then(() => wx.stopPullDownRefresh()); },
  formatTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2,"0") + "-" + d.getDate().toString().padStart(2,"0") + " " + d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
  },
  loadStatus() {
    this.setData({ loading: true, error: null });
    return api.request("/status").then(d => {
      d.lastCheckAtFormatted = this.formatTime(d.lastCheckAt);
      this.setData({ status: d, loading: false });
    }).catch(e => {
      this.setData({ error: "连接失败: " + (e.errMsg || e.message || "无法连接"), loading: false });
    });
  },
  refresh() { this.loadStatus(); },
  doCheck() {
    wx.showLoading({ title: "检查中..." });
    api.post("/check").then(d => {
      wx.hideLoading();
      if (d.checked) { wx.showToast({ title: "检查完成", icon: "success" }); if (d.added.length) wx.showModal({ title: "新增成绩", content: d.added.map(a => a.kcmc + "=" + a.cj).join("\n") }); }
      else wx.showToast({ title: d.error || "检查失败", icon: "none" });
      this.loadStatus();
    }).catch(e => { wx.hideLoading(); wx.showToast({ title: "请求失败", icon: "none" }); });
  }
});
