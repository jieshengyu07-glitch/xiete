const api = require("../../utils/api");
Page({
  data: {
    grades: [],
    groupedGrades: [],
    currentGroup: null,
    currentGrades: [],
    activeTermIndex: 0,
    count: 0,
    loading: true,
    error: null
  },
  onShow() { this.loadGrades(); },
  onPullDownRefresh() { this.loadGrades().then(() => wx.stopPullDownRefresh()); },
  shortTermName(termName) {
    return String(termName || "未分组").replace("学年", " ");
  },
  normalizeGroups(d) {
    const grades = d.grades || [];
    const source = (d.groupedGrades && d.groupedGrades.length)
      ? d.groupedGrades
      : (grades.length ? [{ key: "default", termName: "未分组", grades }] : []);
    return source.map((group, index) => ({
      key: group.key || (String(group.xnm || "") + "_" + String(group.xqm || "") + "_" + index),
      xnm: group.xnm || "",
      xqm: group.xqm || "",
      termName: group.termName || "未分组",
      shortName: this.shortTermName(group.termName || "未分组"),
      grades: group.grades || []
    }));
  },
  loadGrades() {
    this.setData({ loading: true, error: null });
    return api.request("/grades").then(d => {
      const grades = d.grades || [];
      const groupedGrades = this.normalizeGroups(d);
      const currentGroup = groupedGrades[0] || null;
      this.setData({
        grades,
        groupedGrades,
        currentGroup,
        currentGrades: currentGroup ? currentGroup.grades : [],
        activeTermIndex: 0,
        count: d.count || grades.length,
        loading: false
      });
    }).catch(e => {
      this.setData({ error: "连接失败: " + (e.errMsg || e.message), loading: false });
    });
  },
  selectTerm(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const currentGroup = this.data.groupedGrades[index] || null;
    this.setData({
      activeTermIndex: index,
      currentGroup,
      currentGrades: currentGroup ? currentGroup.grades : []
    });
  },
  formatTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2,"0") + "-" + d.getDate().toString().padStart(2,"0") + " " + d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0");
  }
});
