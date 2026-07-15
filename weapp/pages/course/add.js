const api = require("../../utils/api");
const features = require("../../config/features");
const schoolData = require("../../data/school");

function blockCourseRatingPage() {
  if (features.enableCourseRating) return false;
  wx.showToast({ title: "课程评分暂未开放", icon: "none" });
  wx.switchTab({ url: "/pages/timetable/timetable" });
  return true;
}

function normalizeSchoolData(payload) {
  let colleges = [];
  if (Array.isArray(payload && payload.colleges)) {
    colleges = payload.colleges;
  } else if (payload && typeof payload === "object") {
    colleges = Object.keys(payload).map(name => ({
      id: name,
      name,
      majors: payload[name]
    }));
  }
  return colleges.map(item => {
    const majors = Array.isArray(item && item.majors) ? item.majors : [];
    return {
      id: String((item && item.id) || (item && item.name) || "").trim(),
      name: String((item && item.name) || "").trim(),
      majors: majors.map(major => {
        if (major && typeof major === "object") {
          return {
            id: String(major.id || major.name || "").trim(),
            name: String(major.name || "").trim()
          };
        }
        const name = String(major || "").trim();
        return { id: name, name };
      }).filter(major => major.name)
    };
  }).filter(item => item.name && item.majors.length);
}

Page({
  data: {
    name: "",
    college: "",
    major: "",
    collegeId: "",
    majorId: "",
    schoolColleges: [],
    colleges: [],
    majors: [],
    collegeIndex: 0,
    majorIndex: 0,
    courseTypes: ["考试", "考查"],
    terms: ["大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下", "不确定"],
    typeIndex: 0,
    termIndex: 0,
    submitting: false
  },

  onLoad(options) {
    if (blockCourseRatingPage()) return;
    this.applySchoolData(schoolData);
    if (options.name) this.setData({ name: decodeURIComponent(options.name) });
  },

  input(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },

  applySchoolData(payload) {
    const list = normalizeSchoolData(payload);
    if (!list.length) return;
    const currentCollege = this.data.college;
    const currentCollegeIndex = list.findIndex(item => item.name === currentCollege);
    const collegeIndex = currentCollegeIndex >= 0 ? currentCollegeIndex : 0;
    const selectedCollege = list[collegeIndex];
    const currentMajorIndex = selectedCollege.majors.findIndex(item => item.name === this.data.major);
    const majorIndex = currentMajorIndex >= 0 ? currentMajorIndex : 0;
    const selectedMajor = selectedCollege.majors[majorIndex] || {};

    this.setData({
      schoolColleges: list,
      colleges: list.map(item => item.name),
      majors: selectedCollege.majors.map(item => item.name),
      collegeIndex,
      majorIndex,
      collegeId: selectedCollege.id,
      majorId: selectedMajor.id || "",
      college: selectedCollege.name,
      major: selectedMajor.name || ""
    });
  },

  changeCollege(e) {
    const collegeIndex = Number(e.detail.value);
    const selectedCollege = this.data.schoolColleges[collegeIndex];
    if (!selectedCollege) return;
    const selectedMajor = selectedCollege.majors[0] || {};
    this.setData({
      collegeIndex,
      majorIndex: 0,
      collegeId: selectedCollege.id,
      majorId: selectedMajor.id || "",
      college: selectedCollege.name,
      majors: selectedCollege.majors.map(item => item.name),
      major: selectedMajor.name || ""
    });
  },

  changeMajor(e) {
    const majorIndex = Number(e.detail.value);
    const selectedCollege = this.data.schoolColleges[this.data.collegeIndex];
    const selectedMajor = selectedCollege && selectedCollege.majors
      ? selectedCollege.majors[majorIndex]
      : null;
    this.setData({
      majorIndex,
      majorId: selectedMajor ? selectedMajor.id : "",
      major: selectedMajor ? selectedMajor.name : ""
    });
  },

  changeType(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  changeTerm(e) {
    this.setData({ termIndex: Number(e.detail.value) });
  },

  submit() {
    if (!features.enableCourseRating) return;
    if (!this.data.name) {
      wx.showToast({ title: "请填写课程名称", icon: "none" });
      return;
    }
    if (!this.data.college) {
      wx.showToast({ title: "请选择所属学院", icon: "none" });
      return;
    }
    if (!this.data.major) {
      wx.showToast({ title: "请选择所属专业", icon: "none" });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    const courseType = this.data.courseTypes[this.data.typeIndex];
    const semester = this.data.terms[this.data.termIndex];
    api.post("/api/courses", {
      name: this.data.name,
      courseName: this.data.name,
      collegeId: this.data.collegeId,
      college: this.data.college,
      majorId: this.data.majorId,
      major: this.data.major,
      type: courseType,
      courseType,
      term: semester,
      semester
    }).then(res => {
      const course = res && res.data && res.data.course;
      const duplicated = Boolean(res && res.data && res.data.duplicated);
      wx.showModal({
        title: duplicated ? "已有该课程" : "提交成功",
        content: duplicated ? "已有该课程，是否直接进入评价？" : "课程已加入评分库，可以继续补充评价。",
        showCancel: duplicated,
        cancelText: "留在此页",
        confirmText: duplicated ? "去评价" : "确定",
        success: modalRes => {
          if (duplicated && !modalRes.confirm) return;
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
