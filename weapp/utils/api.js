const app = getApp();

const LOGIN_PAGE = "/pages/settings/settings";

function getToken() {
  return wx.getStorageSync("token") || "";
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

function authError(message) {
  const err = new Error(message || "AUTH_REQUIRED");
  err.code = "AUTH_REQUIRED";
  return err;
}

function goLoginPage() {
  wx.switchTab({
    url: LOGIN_PAGE,
    fail: () => {}
  });
}

function ensureLogin(force) {
  const token = getToken();
  if (!force && token) return Promise.resolve(token);

  if (typeof app.loginWithWechat !== "function") {
    goLoginPage();
    return Promise.reject(authError());
  }

  return app.loginWithWechat(Boolean(force)).then(newToken => {
    if (!newToken) {
      goLoginPage();
      throw authError();
    }
    return newToken;
  }).catch(err => {
    goLoginPage();
    throw err || authError();
  });
}

function normalizeError(res) {
  return {
    statusCode: res.statusCode,
    data: res.data,
    message: res.data && res.data.message
  };
}

function send(path, method, data, options, retried) {
  return ensureLogin(false).then(() => new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      header: Object.assign({
        "Content-Type": "application/json"
      }, authHeader(), options && options.header ? options.header : {}),
      data: data || {},
      timeout: options && options.timeout ? options.timeout : 30000,
      success: res => {
        if (res.statusCode === 401 && !retried) {
          wx.removeStorageSync("token");
          ensureLogin(true)
            .then(() => send(path, method, data, options, true))
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode === 401) {
          wx.removeStorageSync("token");
          goLoginPage();
          reject(authError("UNAUTHORIZED"));
          return;
        }

        if (res.statusCode >= 400) {
          reject(normalizeError(res));
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

module.exports = {
  request,
  get: request,
  post,
  ensureLogin
};
