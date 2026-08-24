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

function currentAuthEpoch() {
  return Number(app && app.globalData && app.globalData.authEpoch || 0);
}

function staleAuthError() {
  const err = new Error("STALE_AUTH_REQUEST");
  err.code = "STALE_AUTH_REQUEST";
  return err;
}

function assertCurrentEpoch(epoch) {
  if (currentAuthEpoch() !== epoch) throw staleAuthError();
}

function invalidateAuthIfCurrent(epoch) {
  if (currentAuthEpoch() !== epoch) return;
  if (app && typeof app.invalidateAuth === "function") app.invalidateAuth();
  else {
    wx.removeStorageSync("token");
    if (app && app.globalData) app.globalData.authEpoch = epoch + 1;
  }
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

  // Initial authentication must always be initiated by an explicit user
  // action on the public landing/login page. `force` is reserved for renewing
  // a previously established session after an authenticated request gets 401.
  if (!force) {
    goLoginPage();
    return Promise.reject(authError("AUTH_REQUIRED"));
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
  const rateLimited = res && res.statusCode === 429;
  return {
    statusCode: res.statusCode,
    data: res.data,
    error: res.data && res.data.error,
    message: rateLimited
      ? "操作太频繁，请稍后再试"
      : ((res.data && (res.data.message || res.data.error)) || ("HTTP " + res.statusCode))
  };
}

function normalizeFailError(err) {
  return {
    errMsg: err && err.errMsg,
    message: (err && (err.message || err.errMsg)) || "request failed"
  };
}

function send(path, method, data, options, retried, requestEpoch) {
  const epoch = requestEpoch === undefined ? currentAuthEpoch() : requestEpoch;
  return ensureLogin(false).then(() => {
    assertCurrentEpoch(epoch);
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
        if (currentAuthEpoch() !== epoch) {
          reject(staleAuthError());
          return;
        }
        if (res.statusCode === 401 && !retried) {
          wx.removeStorageSync("token");
          ensureLogin(true)
            .then(() => send(path, method, data, options, true, currentAuthEpoch()))
            .then(resolve)
            .catch(err => {
              invalidateAuthIfCurrent(epoch);
              reject(err);
            });
          return;
        }

        if (res.statusCode === 401) {
          invalidateAuthIfCurrent(epoch);
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
      fail: err => {
        if (currentAuthEpoch() !== epoch) reject(staleAuthError());
        else reject(normalizeFailError(err));
      }
    });
    });
  });
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
  const epoch = currentAuthEpoch();
  const key = epoch + ":GET:" + String(path || "");
  if (pendingGets.has(key)) return pendingGets.get(key);
  const task = send(path, "GET", null, options, false, epoch);
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

function clearPendingAuthRequests() {
  pendingGets.clear();
}

module.exports = {
  request,
  get: request,
  publicRequest,
  publicGet: publicRequest,
  post,
  del,
  ensureLogin,
  clearPendingAuthRequests
};
