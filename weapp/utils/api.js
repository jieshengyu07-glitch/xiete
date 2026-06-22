const app = getApp();

function authHeader() {
  const token = app.globalData.token || wx.getStorageSync("authToken") || "";
  return token ? { Authorization: "Bearer " + token } : {};
}

function request(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: "GET",
      header: authHeader(),
      timeout: 30000,
      success: res => resolve(res.data),
      fail: err => reject(err)
    });
  });
}

function post(path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: "POST",
      header: authHeader(),
      data: data || {},
      timeout: 30000,
      success: res => resolve(res.data),
      fail: err => reject(err)
    });
  });
}

module.exports = { request, post };
