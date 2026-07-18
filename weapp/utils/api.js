const app = getApp();

const LOGIN_PAGE = "/pages/login/index";
const PRIVACY_ACCEPTED_KEY = "privacyAccepted";
const MANUAL_LOGOUT_KEY = "manualLogout";
const pendingGets = new Map();
let loginNavigationPending = false;

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
  if (loginNavigationPending) return;
  loginNavigationPending = true;
  wx.navigateTo({
    url: LOGIN_PAGE,
    complete: () => {
      setTimeout(() => { loginNavigationPending = false; }, 500);
    }
  });
}

function ensureLogin(force) {
  const token = getToken();
  if (!force && token) return Promise.resolve(token);

  if (wx.getStorageSync(MANUAL_LOGOUT_KEY)) {
    goLoginPage();
    return Promise.reject(authError("MANUAL_LOGOUT"));
  }

  if (!wx.getStorageSync(PRIVACY_ACCEPTED_KEY)) {
    goLoginPage();
    const err = authError("PRIVACY_CONSENT_REQUIRED");
    err.code = "PRIVACY_CONSENT_REQUIRED";
    return Promise.reject(err);
  }

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
    error: res.data && res.data.error,
    message: (res.data && (res.data.message || res.data.error)) || ("HTTP " + res.statusCode)
  };
}

function normalizeFailError(err) {
  return {
    errMsg: err && err.errMsg,
    message: (err && (err.message || err.errMsg)) || "request failed"
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
      fail: err => reject(normalizeFailError(err))
    });
  }));
}

function sendPublic(path, method, data, options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      header: Object.assign({
        "Content-Type": "application/json"
      }, authHeader(), options && options.header ? options.header : {}),
      data: data || {},
      timeout: options && options.timeout ? options.timeout : 30000,
      success: res => {
        if (res.statusCode >= 400) {
          reject(normalizeError(res));
          return;
        }
        resolve(res.data);
      },
      fail: err => reject(normalizeFailError(err))
    });
  });
}

function request(path, options) {
  const key = String(path || "");
  if (pendingGets.has(key)) return pendingGets.get(key);
  const task = send(path, "GET", null, options, false);
  const cleanup = () => {
    if (pendingGets.get(key) === task) pendingGets.delete(key);
  };
  task.then(cleanup, cleanup);
  pendingGets.set(key, task);
  return task;
}

function post(path, data, options) {
  return send(path, "POST", data, options, false);
}

function del(path, data, options) {
  return send(path, "DELETE", data, options, false);
}

function publicRequest(path, options) {
  return sendPublic(path, "GET", null, options);
}

module.exports = {
  request,
  get: request,
  publicRequest,
  publicGet: publicRequest,
  post,
  del,
  ensureLogin
};
