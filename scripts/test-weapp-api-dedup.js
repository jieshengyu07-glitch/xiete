const assert = require("assert");

let requestCount = 0;
let pendingSuccess;
global.getApp = () => ({
  globalData: { apiBase: "https://example.invalid" },
  loginWithWechat: async () => "token"
});
global.wx = {
  getStorageSync: key => key === "token" ? "token" : "",
  removeStorageSync: () => {},
  navigateTo: () => {},
  request(options) {
    requestCount += 1;
    pendingSuccess = options.success;
  }
};

async function main() {
  const api = require("../weapp/utils/api");
  const first = api.request("/status");
  const second = api.request("/status");
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.strictEqual(requestCount, 1);
  pendingSuccess({ statusCode: 200, data: { success: true } });
  const values = await Promise.all([first, second]);
  assert.deepStrictEqual(values, [{ success: true }, { success: true }]);

  const third = api.request("/status");
  await Promise.resolve();
  assert.strictEqual(requestCount, 2);
  pendingSuccess({ statusCode: 200, data: { success: true, fresh: true } });
  assert.strictEqual((await third).fresh, true);
  console.log("weappConcurrentGetRequestDedupTest=passed");
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
