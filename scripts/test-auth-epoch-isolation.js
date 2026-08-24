const assert = require("assert");
const path = require("path");

async function pendingGetIsolationTest() {
  const requests = [];
  const storage = { token: "token-a" };
  const app = {
    globalData: { apiBase: "https://example.invalid", authEpoch: 0 },
    loginWithWechat: async () => storage.token
  };
  global.getApp = () => app;
  global.wx = {
    getStorageSync: key => storage[key] || "",
    removeStorageSync: key => { delete storage[key]; },
    navigateTo: () => {},
    request(options) { requests.push(options); }
  };
  const apiPath = require.resolve("../weapp/utils/api");
  delete require.cache[apiPath];
  const api = require(apiPath);

  const oldRequest = api.get("/grades");
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(requests.length, 1);

  api.clearPendingAuthRequests();
  app.globalData.authEpoch += 1;
  storage.token = "token-b";
  const newRequest = api.get("/grades");
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(requests.length, 2);

  requests[0].success({ statusCode: 200, data: { owner: "A" } });
  await assert.rejects(oldRequest, err => err && err.code === "STALE_AUTH_REQUEST");
  requests[1].success({ statusCode: 200, data: { owner: "B" } });
  assert.deepStrictEqual(await newRequest, { owner: "B" });
  console.log("pendingGetAuthEpochIsolationTest=passed");
}

async function refreshLogoutRaceTest() {
  let appDefinition;
  let loginRequest;
  const storage = { token: "old-token" };
  global.App = definition => { appDefinition = definition; };
  global.wx = {
    login(options) { options.success({ code: "wechat-code" }); },
    request(options) { loginRequest = options; },
    getStorageSync: key => storage[key] || "",
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; }
  };
  const appPath = require.resolve("../weapp/app");
  delete require.cache[appPath];
  require(appPath);
  const refresh = appDefinition.loginWithWechat.call(appDefinition, true);
  appDefinition.invalidateAuth.call(appDefinition);
  loginRequest.success({ statusCode: 200, data: { token: "stale-token" } });
  await assert.rejects(refresh, err => err && err.code === "STALE_AUTH_REQUEST");
  assert.strictEqual(storage.token, undefined);
  assert.strictEqual(appDefinition.globalData.authEpoch, 1);
  console.log("logoutPreventsPending401RefreshTokenRestoreTest=passed");
}

pendingGetIsolationTest()
  .then(refreshLogoutRaceTest)
  .catch(err => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
