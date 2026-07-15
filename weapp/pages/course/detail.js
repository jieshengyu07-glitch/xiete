const api = require("../../utils/api");
const features = require("../../config/features");

const fallbackCourseId = "course_auto_theory";

function blockCourseRatingPage() {
  if (features.enableCourseRating) return false;
  wx.showToast({ title: "课程评分暂未开放", icon: "none" });
  wx.switchTab({ url: "/pages/timetable/timetable" });
  return true;
}

function emptyCourse() {
  return {
    id: "",
    name: "课程详情",
    college: "",
    major: "",
    score: "0.0",
    reviews: 0,
    dimensions: [
      { label: "课程难度", value: "0.0" },
      { label: "给分友好", value: "0.0" },
      { label: "作业量", value: "0.0" },
      { label: "推荐程度", value: "0.0" }
    ],
    guide: [],
    papers: [],
    resources: [],
    comments: []
  };
}

function fallbackCourse() {
  const course = emptyCourse();
  course.id = fallbackCourseId;
  course.name = "汽车理论";
  course.college = "车辆与交通工程学院";
  course.major = "车辆工程";
  course.score = "7.4";
  course.dimensions = [
    { label: "课程难度", value: "8.2" },
    { label: "给分友好", value: "6.9" },
    { label: "作业量", value: "7.6" },
    { label: "推荐程度", value: "7.8" }
  ];
  return course;
}

function mapDetail(data) {
  const course = data.course || {};
  return {
    id: course.id,
    name: course.name,
    college: course.college,
    major: course.major,
    score: String(course.score || course.ratingAvg || "0.0"),
    reviews: course.reviewCount || 0,
    dimensions: data.dimensions || [],
    guide: data.guide || [],
    papers: data.papers || [],
    resources: data.resources || [],
    comments: (data.reviews || []).map(item => ({
      id: item.id,
      text: item.content,
      tags: item.tags || [],
      score: item.score,
      likeCount: item.likeCount || 0,
      liked: Boolean(item.liked)
    }))
  };
}

function reviewErrorTitle(err) {
  if (err && err.code === "AUTH_REQUIRED") return "请先登录后再发布评价";
  if (err && err.statusCode === 401) return "请先登录后再发布评价";
  if (err && err.statusCode === 404) return "评价接口不存在，请检查接口路径";
  return (err && err.message) || "提交失败";
}

Page({
  data: {
    courseId: "",
    course: emptyCourse(),
    reviewForm: {
      score: "8",
      difficulty: "8",
      grading: "8",
      workload: "6",
      recommend: "8",
      tags: "",
      content: ""
    },
    submittingReview: false,
    safetyTip: "请上传已经结束考试的往年资料、公开复习资料或个人整理的题型回忆。禁止上传正在进行或尚未结束考试的题目、偷拍内容、未授权答案、个人隐私或违规资料。"
  },

  onLoad(options) {
    if (blockCourseRatingPage()) return;
    const courseId = options && (options.id || options.courseId) ? String(options.id || options.courseId) : "";
    if (!courseId) {
      this.setData({ courseId: "", course: emptyCourse() });
      wx.showToast({ title: "课程信息缺失，请返回重试", icon: "none" });
      return;
    }
    this.setData({ courseId });
    this.loadCourse();
  },

  loadCourse() {
    if (!features.enableCourseRating) return;
    const courseId = this.data.courseId;
    if (!courseId) {
      wx.showToast({ title: "课程信息缺失，请返回重试", icon: "none" });
      return;
    }
    api.publicGet("/api/courses/" + encodeURIComponent(courseId)).then(res => {
      this.setData({ course: mapDetail(res.data || {}) });
    }).catch(err => {
      this.setData({ course: courseId === fallbackCourseId ? fallbackCourse() : emptyCourse() });
      wx.showToast({ title: (err && err.statusCode === 404) ? "课程不存在" : "课程详情加载失败", icon: "none" });
    });
  },

  inputReview(e) {
    this.setData({ ["reviewForm." + e.currentTarget.dataset.key]: e.detail.value });
  },

  submitReview() {
    if (!features.enableCourseRating) return;
    const courseId = this.data.courseId || (this.data.course && this.data.course.id);
    if (!courseId) {
      wx.showToast({ title: "课程信息缺失，请返回重试", icon: "none" });
      return;
    }

    const form = this.data.reviewForm;
    if (!String(form.content || "").trim()) {
      wx.showToast({ title: "请填写评价内容", icon: "none" });
      return;
    }
    if (this.data.submittingReview) return;

    const reviewUrl = "/api/courses/" + encodeURIComponent(courseId) + "/reviews";
    console.log("[course review] courseId:", courseId);
    console.log("[course review] url:", reviewUrl);

    this.setData({ submittingReview: true });
    api.post(reviewUrl, {
      score: Number(form.score),
      difficulty: Number(form.difficulty),
      grading: Number(form.grading),
      workload: Number(form.workload),
      recommend: Number(form.recommend),
      tags: form.tags,
      content: form.content
    }).then(() => {
      wx.showToast({ title: "评价已保存", icon: "success" });
      this.setData({ "reviewForm.content": "", "reviewForm.tags": "" });
      this.loadCourse();
    }).catch(err => {
      wx.showToast({ title: reviewErrorTitle(err), icon: "none" });
    }).finally(() => {
      this.setData({ submittingReview: false });
    });
  },

  toggleReviewLike(e) {
    if (!features.enableCourseRating) return;
    const id = e.currentTarget.dataset.id;
    api.post("/api/course-reviews/" + encodeURIComponent(id) + "/like").then(res => {
      const data = res && res.data ? res.data : {};
      const comments = this.data.course.comments.map(item => {
        if (item.id !== id) return item;
        return Object.assign({}, item, {
          liked: Boolean(data.liked),
          likeCount: data.likeCount
        });
      });
      this.setData({ "course.comments": comments });
    }).catch(err => {
      wx.showToast({
        title: err && err.code === "AUTH_REQUIRED" ? "请先登录后再点赞" : ((err && err.message) || "点赞失败"),
        icon: "none"
      });
    });
  }
});
