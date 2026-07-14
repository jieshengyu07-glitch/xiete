const api = require("../../utils/api");

Page({
  data: {
    name: "",
    college: "",
    major: "",
    remark: "",
    courseTypes: ["必修", "选修", "通识", "不确定"],
    terms: ["大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下", "不确定"],
    typeIndex: 0,
    termIndex: 0,
    submitting: false
  },

  onLoad(options) {
    if (options.name) this.setData({ name: decodeURIComponent(options.name) });
  },

  input(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },

  changeType(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  changeTerm(e) {
    this.setData({ termIndex: Number(e.detail.value) });
  },

  submit() {
    if (!this.data.name) {
      wx.showToast({ title: "请填写课程名称", icon: "none" });
      return;
    }
    if (!this.data.college) {
      wx.showToast({ title: "请填写所属学院", icon: "none" });
      return;
    }
    if (!this.data.major) {
      wx.showToast({ title: "请填写所属专业", icon: "none" });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api.post("/api/courses", {
      name: this.data.name,
      college: this.data.college,
      major: this.data.major,
      type: this.data.courseTypes[this.data.typeIndex],
      term: this.data.terms[this.data.termIndex],
      remark: this.data.remark
    }).then(res => {
      const course = res && res.data && res.data.course;
      wx.showModal({
        title: res && res.data && res.data.duplicated ? "课程已存在" : "提交成功",
        content: res && res.data && res.data.duplicated ? "已找到同名课程，即将打开课程详情。" : "课程已加入评分库，可以继续补充评价。",
        showCancel: false,
        success: () => {
          wx.redirectTo({ url: "/pages/course/detail" + (course && course.id ? "?id=" + encodeURIComponent(course.id) : "") });
        }
      });
    }).catch(err => {
      wx.showToast({
        title: err && err.code === "AUTH_REQUIRED" ? "请先登录" : ((err && err.message) || "提交失败"),
        icon: "none"
      });
    }).finally(() => {
      this.setData({ submitting: false });
    });
  }
});
