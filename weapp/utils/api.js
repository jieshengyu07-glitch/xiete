const app = getApp();

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

function loginError() {
  const err = new Error("登录状态异常，请重新打开小程序");
  err.code = "LOGIN_STATE_INVALID";
  return err;
}

function ensureLogin(force) {
  if (!force && app.globalData.loginPromise) {
    return app.globalData.loginPromise.then(token => {
      if (!token) throw loginError();
      return token;
    }).catch(() => {
      throw loginError();
    });
  }

  const token = app.globalData.token || wx.getStorageSync("authToken") || "";
  if (!force && token) {
    app.globalData.token = token;
    return Promise.resolve(token);
  }

  if (force) clearAuthToken();
  if (typeof app.loginWithWechat !== "function") return Promise.reject(loginError());

  return app.loginWithWechat(Boolean(force)).then(token => {
    if (!token) throw loginError();
    return token;
  }).catch(() => {
    throw loginError();
  });
}

function mergeHeader(header) {
  return Object.assign({}, header || {}, authHeader());
}

function send(path, method, data, options, hasRetried) {
  return ensureLogin(false).then(() => new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method: method,
      header: mergeHeader(options && options.header),
      data: data || {},
      timeout: options && options.timeout ? options.timeout : 30000,
      success: res => {
        if (isInvalidTokenResponse(res) && !hasRetried) {
          ensureLogin(true)
            .then(() => send(path, method, data, options, true))
            .then(resolve)
            .catch(reject);
          return;
        }
        if (isInvalidTokenResponse(res)) {
          clearAuthToken();
          reject(loginError());
          return;
        }
        resolve(res.data);
      },
      fail: err => reject(err)
    });
  }));
}

function request(path, options) {
  return send(path, "GET", null, options, false);
}

function post(path, data, options) {
  return send(path, "POST", data, options, false);
}

module.exports = { request, get: request, post, ensureLogin };
