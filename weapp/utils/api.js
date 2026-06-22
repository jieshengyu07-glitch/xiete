const app = getApp();
let refreshTokenPromise = null;

function authHeader() {
  const token = app.globalData.token || wx.getStorageSync("authToken") || "";
  return token ? { Authorization: "Bearer " + token } : {};
}

function clearAuthToken() {
  app.globalData.token = "";
  wx.removeStorageSync("authToken");
}

function isInvalidTokenResponse(res) {
  const data = res.data || {};
  return res.statusCode === 401 || data.error === "INVALID_TOKEN" || data.code === "INVALID_TOKEN";
}

function refreshAuthToken() {
  if (refreshTokenPromise) return refreshTokenPromise;

  clearAuthToken();
  const loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: loginRes => {
        if (!loginRes.code) {
          reject(new Error("wx.login did not return code"));
          return;
        }

        wx.request({
          url: app.globalData.apiBase + "/auth/wechat-login",
          method: "POST",
          data: { code: loginRes.code },
          timeout: 10000,
          success: res => {
            const data = res.data || {};
            if (data.success && data.token) {
              app.globalData.token = data.token;
              wx.setStorageSync("authToken", data.token);
              resolve(data.token);
              return;
            }
            reject(data);
          },
          fail: err => reject(err)
        });
      },
      fail: err => reject(err)
    });
  });

  refreshTokenPromise = loginPromise.then(
    token => {
      refreshTokenPromise = null;
      return token;
    },
    err => {
      refreshTokenPromise = null;
      throw err;
    }
  );

  return refreshTokenPromise;
}

function mergeHeader(header) {
  return Object.assign({}, header || {}, authHeader());
}

function send(path, method, data, options, hasRetried) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: method,
      header: mergeHeader(options && options.header),
      data: data || {},
      timeout: options && options.timeout ? options.timeout : 30000,
      success: res => {
        if (isInvalidTokenResponse(res) && !hasRetried) {
          refreshAuthToken()
            .then(() => send(path, method, data, options, true))
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve(res.data);
      },
      fail: err => reject(err)
    });
  });
}

function request(path, options) {
  return send(path, "GET", null, options, false);
}

function post(path, data, options) {
  return send(path, "POST", data, options, false);
}

module.exports = { request, post };
