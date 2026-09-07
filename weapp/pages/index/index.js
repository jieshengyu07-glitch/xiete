const announcementService = require("../../utils/announcement");

Page({
  data: {
    loggedIn: false,
    announcement: null,
    showAnnouncementBanner: false,
    announcementVisible: false
  },

  onShow() {
    this.setData({ loggedIn: Boolean(wx.getStorageSync("token")) });
    this.loadAnnouncement();
  },

  loadAnnouncement() {
    announcementService.loadAnnouncement({ allowAutoPopup: true })
      .then(result => {
        const item = result.announcement;
        this.setData({
          announcement: item,
          showAnnouncementBanner: Boolean(item && item.enabled),
          announcementVisible: Boolean(result.shouldAutoOpen)
        });
      })
      .catch(() => {
        this.setData({ showAnnouncementBanner: false, announcementVisible: false });
      });
  },

  openAnnouncement() {
    if (this.data.announcement && this.data.announcement.enabled) {
      this.setData({ announcementVisible: true });
    }
  },

  closeAnnouncement() {
    announcementService.dismissAnnouncement(this.data.announcement);
    this.setData({ announcementVisible: false });
  },

  continueToService() {
    if (this.data.loggedIn) {
      wx.switchTab({ url: "/pages/timetable/timetable" });
      return;
    }
    wx.navigateTo({ url: "/pages/login/index" });
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: "/pages/privacy/index" }) });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
  }
});
