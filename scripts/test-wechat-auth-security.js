const assert = require("assert");
const { assertWechatConfig, resolveWechatOpenid } = require("../src/services/wechatAuth");

async function withEnv(values, run) {
  const names = ["NODE_ENV", "WECHAT_APPID", "WECHAT_SECRET"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    names.forEach(name => {
      if (values[name] === undefined) delete process.env[name];
      else process.env[name] = values[name];
    });
    return await run();
  } finally {
    names.forEach(name => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
}

async function main() {
  await withEnv({ NODE_ENV: "production", WECHAT_APPID: undefined, WECHAT_SECRET: "secret" }, async () => {
    assert.throws(assertWechatConfig, err => err && err.code === "WECHAT_CONFIG_MISSING");
    console.log("productionMissingAppidTest=passed");
  });

  await withEnv({ NODE_ENV: "production", WECHAT_APPID: "appid", WECHAT_SECRET: undefined }, async () => {
    assert.throws(assertWechatConfig, err => err && err.code === "WECHAT_CONFIG_MISSING");
    console.log("productionMissingSecretTest=passed");
  });

  await withEnv({ NODE_ENV: "production", WECHAT_APPID: "appid", WECHAT_SECRET: "secret" }, async () => {
    const config = assertWechatConfig();
    assert.strictEqual(config.developmentFallback, false);
    console.log("productionCompleteConfigTest=passed");
  });

  await withEnv({ NODE_ENV: "development", WECHAT_APPID: undefined, WECHAT_SECRET: undefined }, async () => {
    const userId = await resolveWechatOpenid("local-code");
    assert.strictEqual(userId, "dev_local-code");
    console.log("developmentFallbackTest=passed");
  });

  await withEnv({ NODE_ENV: "production", WECHAT_APPID: "appid", WECHAT_SECRET: "secret" }, async () => {
    let userId = "";
    let error = null;
    try {
      userId = await resolveWechatOpenid("invalid-code", async () => ({
        data: { errcode: 40029, errmsg: "invalid code" }
      }));
    } catch (err) {
      error = err;
    }
    assert(error);
    assert.strictEqual(userId.startsWith("dev_"), false);
    console.log("productionInvalidCodeNoDevUserTest=passed");
  });
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
