const announcementService = require("../../utils/announcement");
const onboarding = require("../../utils/onboarding");

Page({
  data: {
    loggedIn: false,
    guideReady: false,
    manualGuide: false,
    announcement: null,
    showAnnouncementBanner: false,
    announcementVisible: false
  },

  onLoad(options) {
    const manualGuide = onboarding.isManualGuide(options);
    if (!onboarding.shouldShowGuide(wx, options)) {
      wx.switchTab({ url: "/pages/timetable/timetable" });
      return;
    }
    this.setData({ guideReady: true, manualGuide });
  },

  onShow() {
    if (!this.data.guideReady) return;
    this.setData({ loggedIn: Boolean(wx.getStorageSync("token")) });
    this.loadAnnouncement();
  },

  loadAnnouncement() {
    announcementService.loadAnnouncement({ allowAutoPopup: !this.data.manualGuide })
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
    if (!this.data.manualGuide) onboarding.complete(wx);
    wx.switchTab({ url: "/pages/timetable/timetable" });
  },

  openPrivacy() {
    if (typeof wx.openPrivacyContract === "function") {
      wx.openPrivacyContract({ fail: () => wx.navigateTo({ url: "/pages/privacy/index" }) });
      return;
    }
    wx.navigateTo({ url: "/pages/privacy/index" });
  }
});
