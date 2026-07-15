const Module = require("module");

const originalLoad = Module._load;
const realAxios = originalLoad("axios", module, false);
const mockAxios = Object.assign(function(config) { return realAxios(config); }, realAxios, {
  get: async function(url, config) {
    if (String(url).includes("newjwc.tyust.edu.cn/jwglxt/")) {
      return { status: 200, data: "<html>jwxt</html>", headers: {}, config: config || {} };
    }
    return realAxios.get(url, config);
  },
  post: async function(url, data, config) {
    if (String(url).includes("newjwc.tyust.edu.cn/jwglxt/")) {
      return { status: 200, data: { items: [] }, headers: {}, config: config || {} };
    }
    return realAxios.post(url, data, config);
  }
});

function jwxtCookies() {
  return [
    { name: "route", value: "test", domain: "newjwc.tyust.edu.cn", path: "/" },
    { name: "JSESSIONID", value: "test", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" },
    { name: "rememberMe", value: "test", domain: "newjwc.tyust.edu.cn", path: "/jwglxt" }
  ];
}

function unavailableError() {
  const err = new Error("JWXT temporarily unavailable");
  err.code = "JWXT_UNAVAILABLE";
  return err;
}

Module._load = function(request, parent, isMain) {
  if (request === "axios") return mockAxios;
  if (String(request).includes("login/httpJwxtLogin")) {
    return {
      httpPortalLogin: async () => {
        if (process.env.MOCK_BIND_MODE === "invalid") {
          const err = new Error("invalid credentials");
          err.code = "INVALID_CREDENTIALS";
          err.portalResult = { containsInvalidCredential: true, status: 200 };
          throw err;
        }
        return {
          cookieJar: [{ name: "portal", value: "test" }],
          portalResult: { status: 200, containsPortalHome: true }
        };
      },
      continueJwxtSso: async () => {
        if (process.env.MOCK_BIND_MODE === "down" || process.env.MOCK_BIND_MODE === "recover") throw unavailableError();
        return { cookies: jwxtCookies(), jwxtJSessionId: "present", finalUrl: "https://newjwc.tyust.edu.cn/jwglxt/" };
      },
      httpJwxtLogin: async () => {
        if (process.env.MOCK_BIND_MODE === "down") throw unavailableError();
        return { cookies: jwxtCookies() };
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
