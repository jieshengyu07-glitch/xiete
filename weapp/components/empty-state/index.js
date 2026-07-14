Component({
  properties: {
    title: {
      type: String,
      value: "暂无数据"
    },
    subtitle: {
      type: String,
      value: ""
    },
    buttonText: {
      type: String,
      value: ""
    },
    imageType: {
      type: String,
      value: "default"
    }
  },

  methods: {
    onTap() {
      this.triggerEvent("action");
    }
  }
});
