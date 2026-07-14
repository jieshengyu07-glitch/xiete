const api = require("../../utils/api");

const fallbackCourseReviews = [
  {
    rank: "TOP 1",
    courseId: "course_auto_theory",
    name: "汽车理论",
    score: "7.4",
    meta: "86人评价 · 128赞",
    tags: ["考试难", "计算多", "闭卷"],
    quote: "计算题一定要提前练，动力性和制动性很重要。"
  },
  {
    rank: "TOP 2",
    courseId: "course_new_energy_intro",
    name: "新能源汽车概论",
    score: "8.6",
    meta: "44人评价 · 96赞",
    tags: ["重点明确", "好过", "开卷"],
    quote: "老师画的星号内容比较重要，开卷也不能完全裸考。"
  },
  {
    rank: "TOP 3",
    courseId: "course_advanced_math_a",
    name: "高等数学A",
    score: "6.8",
    meta: "132人评价 · 88赞",
    tags: ["难度高", "需要刷题", "闭卷"],
    quote: "别等期末才开始，高数真不能纯靠突击。"
  }
];

function mapCourseReview(item, index) {
  return {
    rank: item.rankText || ("TOP " + (item.rank || index + 1)),
    courseId: item.courseId,
    name: item.name,
    score: String(item.score || "0.0"),
    meta: (item.reviewCount || 0) + "人评价 · " + (item.likeCount || 0) + "赞",
    tags: item.tags || [],
    quote: item.quote || ""
  };
}

Page({
  data: {
    entries: [
      {
        title: "搜索课程",
        desc: "查看课程难度、给分和同学评价",
        icon: "课",
        url: "/pages/course/index"
      },
      {
        title: "发布评价",
        desc: "找不到课程时可先添加课程再评价",
        icon: "评",
        url: "/pages/course/add"
      }
    ],
    hotCourseReviews: fallbackCourseReviews
  },

  onLoad() {
    this.loadHome();
  },

  onShow() {
    this.loadHome();
  },

  loadHome() {
    api.publicGet("/api/home").then(res => {
      const data = res && res.data ? res.data : {};
      this.setData({
        hotCourseReviews: (data.hotCourseReviews || []).map(mapCourseReview)
      });
    }).catch(() => {
      this.setData({
        hotCourseReviews: fallbackCourseReviews
      });
    });
  },

  openEntry(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  openCourse(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/course/detail" + (id ? "?id=" + encodeURIComponent(id) : "") });
  }
});
