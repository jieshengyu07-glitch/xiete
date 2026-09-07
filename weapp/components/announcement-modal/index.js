Component({
  properties: {
    visible: { type: Boolean, value: false },
    announcement: { type: Object, value: null }
  },

  methods: {
    stopPropagation() {},

    close() {
      this.triggerEvent("close");
    },

    previewImage() {
      const imageUrl = String((this.data.announcement && this.data.announcement.imageUrl) || "");
      if (!imageUrl) return;
      wx.previewImage({ current: imageUrl, urls: [imageUrl] });
    }
  }
});
