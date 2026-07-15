const api = require("../../utils/api");
const { formatJwxtErrorMessage, isCaptchaRequired } = require("../../utils/jwxtError");

function pick(item, keys, fallback) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = item && item[keys[i]];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback || "";
}

function termNameOf(grade) {
  const explicit = pick(grade, ["termName", "term", "semester", "xqmc"], "");
  if (explicit) return explicit;
  const xnm = pick(grade, ["xnm", "XNM"], "");
  const xqm = pick(grade, ["xqm", "XQM"], "");
  if (!xnm && !xqm) return "未分组";
  const term = xqm === "3" ? "第1学期" : (xqm === "12" ? "第2学期" : xqm);
  return (xnm ? xnm + "-" + (Number(xnm) + 1) + "学年" : "") + (term || "");
}

function normalizeGrade(grade, index) {
  const termName = termNameOf(grade);
  const source = pick(grade, ["source"], "jwxt");
  return {
    id: pick(grade, ["id"], "") || (pick(grade, ["xh", "studentId"], "") + "_" + pick(grade, ["kcmc", "KCMC", "courseName", "课程名称"], "course") + "_" + index),
    courseName: pick(grade, ["kcmc", "KCMC", "courseName", "name", "课程名称"], "未知课程"),
    score: pick(grade, ["cj", "CJ", "score", "grade", "成绩"], "-"),
    credit: pick(grade, ["xf", "XF", "credit", "credits", "学分"], "-"),
    courseType: pick(grade, ["kclb", "KCLB", "courseType", "type", "课程类型"], "-"),
    termName,
    source,
    sourceText: source === "xg" || source === "jwxt" ? "校内成绩系统" : "校内成绩系统",
    raw: grade
  };
}

Page({
  data: {
    grades: [],
    groupedGrades: [],
    currentGroup: null,
    currentGrades: [],
    activeTermIndex: 0,
    count: 0,
    loading: true,
    refreshing: false,
    syncing: false,
    error: null,
    notice: ""
  },

  onShow() {
    this._gradesPageActive = true;
    this._syncPollAttempts = 0;
    this.loadGrades();
  },

  onHide() {
    this._gradesPageActive = false;
    this.stopSyncPolling();
  },

  onUnload() {
    this._gradesPageActive = false;
    this.stopSyncPolling();
  },

  onPullDownRefresh() {
    this.loadGrades().then(() => wx.stopPullDownRefresh());
  },

  shortTermName(termName) {
    return String(termName || "未分组").replace("学年", " ");
  },

  normalizeGroups(data, normalizedGrades) {
    const source = (data.groupedGrades && data.groupedGrades.length)
      ? data.groupedGrades
      : (normalizedGrades.length ? [{ key: "default", termName: "未分组", grades: normalizedGrades }] : []);

    return source.map((group, index) => {
      const grades = (group.grades || []).map((grade, gradeIndex) => {
        return normalizeGrade(grade, gradeIndex);
      });
      const termName = group.termName || (grades[0] && grades[0].termName) || "未分组";
      return {
        key: group.key || (String(group.xnm || "") + "_" + String(group.xqm || "") + "_" + index),
        termName,
        shortName: this.shortTermName(termName),
        grades
      };
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
    if (!this._gradesPageActive) return;
    this._syncPollAttempts = Number(this._syncPollAttempts || 0) + 1;
    if (this._syncPollAttempts > 40) {
      this.setData({
        syncing: false,
        notice: "成绩同步时间较长，请稍后下拉刷新"
      });
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
    if (!polling) this.setData({ loading: true, error: null });
    return api.request("/grades").then(data => {
      const rawGrades = data.grades || [];
      const grades = rawGrades.map(normalizeGrade);
      const groupedGrades = this.normalizeGroups(data, grades);
      const currentGroup = groupedGrades[0] || null;
      const syncing = Boolean(data.syncing);
      this.setData({
        grades,
        groupedGrades,
        currentGroup,
        currentGrades: currentGroup ? currentGroup.grades : [],
        activeTermIndex: 0,
        count: data.count || grades.length,
        syncing,
        notice: data.warning ? (data.message || "教务系统暂时不可用，当前显示上次查询成绩") : "",
        error: grades.length ? null : (data.message || "暂无成绩数据，请先完成登录或刷新成绩"),
        loading: false
      });
      if (syncing) {
        this.setData({ notice: "正在同步成绩...", error: null });
        this.scheduleSyncPolling();
      } else {
        this.stopSyncPolling();
      }
    }).catch(err => {
      const keepGrades = this.data.grades && this.data.grades.length;
      this.setData({
        notice: keepGrades ? "教务系统暂时不可用，当前显示上次查询成绩" : "",
        error: keepGrades ? null : formatJwxtErrorMessage(err, "暂无成绩数据，请先完成登录或刷新成绩"),
        loading: false
      });
    });
  },

  async refreshGrades() {
    this.stopSyncPolling();
    this._syncPollAttempts = 0;
    this.setData({ refreshing: true, notice: "", error: null });
    try {
      const result = await api.post("/check", {}, { timeout: 120000 });
      this.setData({ refreshing: false });

      if (result && result.syncing) {
        this.setData({
          syncing: true,
          notice: result.message || "正在后台刷新成绩，完成后会自动更新",
          error: null
        });
        wx.showToast({ title: "已开始后台刷新", icon: "none" });
        this.scheduleSyncPolling();
        return;
      }

      if (result && result.checked === false) {
        if (isCaptchaRequired(result)) {
          wx.showModal({
            title: "需要重新验证",
            content: "教务系统需要验证码或重新登录，请完成登录后再刷新成绩。",
            showCancel: false
          });
        } else if (result.error === "XG_LOGIN_REQUIRED" || result.error === "CAMPUS_LOGIN_REQUIRED" || result.error === "LOGIN_REQUIRED") {
          wx.showToast({ title: "成绩登录已失效，请重新登录", icon: "none" });
        } else {
          wx.showToast({ title: "暂时无法同步成绩，请稍后再试", icon: "none" });
        }
      } else {
        wx.showToast({ title: "成绩已刷新", icon: "success" });
      }

      await this.loadGrades();
    } catch (err) {
      this.setData({
        refreshing: false,
        error: this.data.grades.length ? null : "暂时无法同步成绩，请稍后再试"
      });
      const code = String((err && (err.code || err.error || (err.data && err.data.error))) || "");
      wx.showToast({
        title: code === "UNAUTHORIZED" || code === "AUTH_REQUIRED" ? "成绩登录已失效，请重新登录" : "暂时无法同步成绩，请稍后再试",
        icon: "none"
      });
    }
  },

  selectTerm(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const currentGroup = this.data.groupedGrades[index] || null;
    this.setData({
      activeTermIndex: index,
      currentGroup,
      currentGrades: currentGroup ? currentGroup.grades : []
    });
  }
});
