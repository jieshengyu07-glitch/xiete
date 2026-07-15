const api = require("../../utils/api");
const features = require("../../config/features");

function blockCourseRatingPage() {
  if (features.enableCourseRating) return false;
  wx.showToast({ title: "课程评分暂未开放", icon: "none" });
  wx.switchTab({ url: "/pages/timetable/timetable" });
  return true;
}

const fallbackCourses = [
  { id: "course_auto_theory", name: "汽车理论", college: "车辆与交通工程学院", score: "7.4", reviews: 86, tags: ["考试难", "计算多", "闭卷"] },
  { id: "course_new_energy_intro", name: "新能源汽车概论", college: "车辆与交通工程学院", score: "8.6", reviews: 44, tags: ["重点明确", "好过", "开卷"] },
  { id: "course_advanced_math_a", name: "高等数学A", college: "应用科学学院", score: "6.8", reviews: 132, tags: ["难度高", "需要刷题", "闭卷"] }
];

function mapCourse(item) {
  return {
    id: item.id,
    name: item.name,
    college: item.college,
    score: String(item.score || item.ratingAvg || "0.0"),
    reviews: item.reviewCount || item.reviews || 0,
    tags: item.tags || []
  };
}

Page({
  data: {
    keyword: "",
    courses: fallbackCourses,
    results: fallbackCourses,
    searched: false
  },

  onLoad() {
    if (blockCourseRatingPage()) return;
    this.searchCourses("");
  },

  onKeywordInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ keyword, searched: Boolean(keyword) });
    this.searchCourses(keyword);
  },

  searchCourses(keyword) {
    if (!features.enableCourseRating) return;
    api.publicGet("/api/courses/search?keyword=" + encodeURIComponent(keyword || "")).then(res => {
      const courses = ((res && res.data && res.data.courses) || []).map(mapCourse);
      this.setData({
        courses,
        results: courses
      });
    }).catch(() => {
      const results = keyword
        ? fallbackCourses.filter(item => item.name.indexOf(keyword) !== -1)
        : fallbackCourses;
      this.setData({ courses: fallbackCourses, results });
    });
  },

  openDetail(e) {
    if (!features.enableCourseRating) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/course/detail" + (id ? "?id=" + encodeURIComponent(id) : "") });
  },

  addCourse() {
    if (!features.enableCourseRating) return;
    wx.navigateTo({ url: "/pages/course/add?name=" + encodeURIComponent(this.data.keyword) });
  }
});
