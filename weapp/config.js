const config = {
  development: {
    baseUrl: "https://api.taixiaoke.cn"
  },
  production: {
    baseUrl: "https://api.taixiaoke.cn"
  }
};

function getEnvVersion() {
  try {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    return accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion
      ? accountInfo.miniProgram.envVersion
      : "develop";
  } catch (err) {
    return "develop";
  }
}

function getApiEnv() {
  const envVersion = getEnvVersion();
  return envVersion === "release" || envVersion === "trial"
    ? "production"
    : "development";
}

function getApiBase() {
  const envConfig = config[getApiEnv()] || config.development;
  return envConfig.baseUrl;
}

module.exports = {
  config,
  API_BASES: config,
  getApiBase,
  getApiEnv
};
