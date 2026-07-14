const foods = [
  { name: "一餐麻辣香锅", canteen: "一餐", window: "麻辣香锅窗口", score: "9.1", reviews: 84, tags: ["量大", "好吃", "排队久"] },
  { name: "二餐黄焖鸡", canteen: "二餐", window: "快餐窗口", score: "8.4", reviews: 77, tags: ["稳定", "管饱", "性价比高"] },
  { name: "炸鸡饭", canteen: "一餐", window: "盖饭窗口", score: "7.7", reviews: 52, tags: ["香", "分量足", "偏油"] }
];

Page({
  data: {
    keyword: "",
    foods,
    results: foods
  },

  onKeywordInput(e) {
    const keyword = e.detail.value.trim();
    const results = keyword
      ? foods.filter(item => item.name.indexOf(keyword) !== -1 || item.canteen.indexOf(keyword) !== -1 || item.window.indexOf(keyword) !== -1)
      : foods;
    this.setData({ keyword, results });
  },

  openDetail() {
    wx.navigateTo({ url: "/pages/food/detail" });
  }
});
