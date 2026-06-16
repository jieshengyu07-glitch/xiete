const app = getApp();

function request(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: "GET",
      timeout: 10000,
      success: res => resolve(res.data),
      fail: err => reject(err)
    });
  });
}

function post(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: "POST",
      timeout: 10000,
      success: res => resolve(res.data),
      fail: err => reject(err)
    });
  });
}

module.exports = { request, post };
