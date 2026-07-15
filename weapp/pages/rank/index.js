const api = require("../../utils/api");
const features = require("../../config/features");

const foodItems = [
  {
    rank: 1,
    name: "一餐麻辣香锅",
    canteen: "一餐",
    score: "9.1",
    reviews: 54,
    likes: 102,
    tags: ["量大", "好吃", "排队久"],
    quote: "下课晚了就别去了，排队真的挺长。"
  },
  {
    rank: 2,
    name: "二餐黄焖鸡",
    canteen: "二餐",
    score: "8.4",
    reviews: 37,
    likes: 76,
    tags: ["稳定", "管饱", "性价比高"],
    quote: "不知道吃啥的时候选它一般不会踩雷。"
  },
  {
    rank: 3,
    name: "炸鸡饭",
    canteen: "一餐",
    score: "8.7",
    reviews: 42,
    likes: 69,
    tags: ["香", "分量足", "偏油"],
    quote: "味道可以，但是吃多了有点腻。"
  }
];

const fallbackCourseItems = [
  {
    id: "course_auto_theory",
    rank: 1,
    name: "汽车理论",
    score: "7.4",
    reviews: 86,
    likes: 128,
    tags: ["考试难", "计算多", "闭卷"],
    quote: "计算题一定要提前练，动力性和制动性很重要。"
  },
  {
    id: "course_new_energy_intro",
    rank: 2,
    name: "新能源汽车概论",
    score: "8.6",
    reviews: 44,
    likes: 96,
    tags: ["重点明确", "好过", "开卷"],
    quote: "老师画的星号内容比较重要，开卷也不能完全裸考。"
  },
  {
    id: "course_advanced_math_a",
    rank: 3,
    name: "高等数学A",
    score: "6.8",
    reviews: 132,
    likes: 88,
    tags: ["难度高", "需要刷题", "闭卷"],
    quote: "别等期末才开始，高数真不能纯靠突击。"
  }
];

function courseBoard(items) {
  return {
    title: "课程总榜",
    subtitle: "讨论度和点赞数较高的课程评价",
    type: "course",
    url: "/pages/course/detail",
    items
  };
}

function foodBoard() {
  return {
    title: "美食总榜",
    subtitle: "最近最受关注的食堂、窗口和菜品",
    type: "food",
    url: "/pages/food/detail",
    items: foodItems
  };
}

function mapCourse(item) {
  return {
    id: item.id,
    rank: item.rank,
    name: item.name,
    score: String(item.score || item.ratingAvg || "0.0"),
    reviews: item.reviewCount || 0,
    likes: item.likeCount || 0,
    tags: item.tags || [],
    quote: item.hotReview || ""
  };
}

Page({
  data: {
    boards: features.enableCourseRating ? [
      courseBoard(fallbackCourseItems),
      foodBoard()
    ] : [
      foodBoard()
    ]
  },

  onLoad() {
    this.loadCourseRank();
  },

  onShow() {
    this.loadCourseRank();
  },

  loadCourseRank() {
    if (!features.enableCourseRating) {
      this.setData({ boards: [foodBoard()] });
      return;
    }
    api.publicGet("/api/rank/courses?limit=5").then(res => {
      const courses = ((res && res.data && res.data.courses) || []).map(mapCourse);
      this.setData({
        boards: [
          courseBoard(courses.length ? courses : fallbackCourseItems),
          foodBoard()
        ]
      });
    }).catch(() => {
      this.setData({
        boards: [
          courseBoard(fallbackCourseItems),
          foodBoard()
        ]
      });
    });
  },

  openRankItem(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    if (type === "course") {
      if (!features.enableCourseRating) return;
      wx.navigateTo({ url: "/pages/course/detail" + (id ? "?id=" + encodeURIComponent(id) : "") });
      return;
    }
    wx.navigateTo({ url: "/pages/food/detail" });
  }
});
