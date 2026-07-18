Page({
  data: {
    groups: [
      {
        title: "学习教务",
        items: [
          { title: "今日课表", desc: "查看当天课程安排", icon: "课", url: "/pages/timetable/timetable" },
          { title: "查成绩", desc: "查看已缓存或最新成绩", icon: "绩", url: "/pages/grades/grades" }
        ]
      },
      {
        title: "校园信息",
        items: [
          { title: "校历", desc: "学期周次和近期节点", icon: "历", url: "/pages/calendar/index" }
        ]
      }
    ]
  },

  openTool(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.navigateTo({ url });
  }
});
