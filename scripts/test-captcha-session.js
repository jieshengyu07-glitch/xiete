const assert = require("assert");
const path = require("path");

const modulePath = path.resolve(__dirname, "../src/login/captchaSession.js");
const httpPath = path.resolve(__dirname, "../src/login/httpJwxtLogin.js");
const credentialPath = path.resolve(__dirname, "../src/services/credentialStore.js");
const checkerPath = path.resolve(__dirname, "../src/checker.js");

const cookieJar = [];
const requests = [];
let savedAccount = null;
let savedCookies = null;
let portalBody = "portal home";
let portalFinalUrl = "https://ronghemenhu.tyust.edu.cn/home";

const loginHtml = [
  '<p id="login-page-flowkey">fallback-flow-key</p>',
  '<p id="execution">actual-execution-value</p>',
  '<p id="login-croypto">MTIzNDU2Nzg=</p>',
  '<input type="hidden" name="execution" value="hidden-execution-value">'
].join("");

require.cache[httpPath] = {
  id: httpPath,
  filename: httpPath,
  loaded: true,
  exports: {
    createCookieJar: () => cookieJar,
    parseHiddenValue: (html, id) => {
      const match = String(html).match(new RegExp('<[^>]+id=["\\\']' + id + '["\\\'][^>]*>([^<]*)<\\/[^>]+>', "i"));
      return match ? match[1] : "";
    },
    requestNoRedirect: async (jar, method, url, options) => {
      requests.push({ method, url, data: options && options.data });
      if (method === "GET" && url.includes("/login?service=")) {
        return { status: 200, data: loginHtml, headers: {} };
      }
      if (method === "GET" && url.includes("/findCaptchaCount/")) {
        return { status: 200, data: { data: { captchaInvisible: true } }, headers: {} };
      }
      if (method === "GET" && url.includes("/api/captcha/generate/DEFAULT")) {
        return { status: 200, data: Buffer.from("image"), headers: { "content-type": "image/png" } };
      }
      if (method === "POST" && url.endsWith("/login")) {
        return { status: 302, data: "", headers: { location: "https://ronghemenhu.tyust.edu.cn/home" } };
      }
      throw new Error("unexpected request " + method + " " + url);
    },
    followRedirects: async () => ({
      finalUrl: portalFinalUrl,
      response: { status: 200, data: portalBody, headers: {} }
    }),
    getAndFollow: async () => {
      cookieJar.push({
        name: "JSESSIONID",
        value: "test-session",
        domain: "newjwc.tyust.edu.cn",
        path: "/jwglxt"
      });
      return { finalUrl: "https://newjwc.tyust.edu.cn/jwglxt/xtgl/index_initMenu.html" };
    },
    encryptPassword: () => "encrypted-password",
    isInvalidCredentialPage: () => false,
    findJwxtJSessionId: jar => jar.some(item => item.name === "JSESSIONID") ? "test-session" : "",
    LOGIN_URL: "https://sso.tyust.edu.cn/login?service=test",
    LOGIN_POST_URL: "https://sso.tyust.edu.cn/login",
    CAS_ORIGIN: "https://sso.tyust.edu.cn",
    PORTAL_ORIGIN: "https://ronghemenhu.tyust.edu.cn",
    JWXT_SSO_URL: "https://newjwc.tyust.edu.cn/sso/jasiglogin/jwglxt",
    userAgent: () => "test-agent"
  }
};

require.cache[credentialPath] = {
  id: credentialPath,
  filename: credentialPath,
  loaded: true,
  exports: {
    saveBoundAccount: (studentId, password, userId) => { savedAccount = { studentId, password, userId }; },
    updateBoundAccountStatus: () => {}
  }
};

require.cache[checkerPath] = {
  id: checkerPath,
  filename: checkerPath,
  loaded: true,
  exports: {
    writeCookies: (cookies, userId) => { savedCookies = { cookies, userId }; }
  }
};

const { createCaptchaSession, loginWithCaptcha } = require(modulePath);

async function main() {
  const created = await createCaptchaSession("user-a", "student-a");
  assert.strictEqual(created.success, true);
  assert.ok(created.sessionId);
  assert.ok(created.captchaImage.startsWith("data:image/png;base64,"));
  assert.ok(requests.some(item => item.url.endsWith("/findCaptchaCount/student-a")));

  const result = await loginWithCaptcha("user-a", {
    sessionId: created.sessionId,
    studentId: "student-a",
    password: "temporary-test-password",
    captcha: "a7K9"
  });
  assert.strictEqual(result.success, true);

  const loginPost = requests.find(item => item.method === "POST");
  const form = new URLSearchParams(loginPost.data);
  assert.strictEqual(form.get("execution"), "actual-execution-value");
  assert.strictEqual(form.get("captcha_code"), "a7K9");
  assert.strictEqual(form.has("captcha"), false);
  assert.strictEqual(form.has("verifyCode"), false);
  assert.strictEqual(form.has("validateCode"), false);
  assert.strictEqual(form.has("yzm"), false);
  assert.strictEqual(form.has("code"), false);
  assert.deepStrictEqual(savedAccount, {
    studentId: "student-a",
    password: "temporary-test-password",
    userId: "user-a"
  });
  assert.strictEqual(savedCookies.userId, "user-a");
  console.log("captchaUsesStudentScopedSessionAndExactFormFieldsTest=passed");

  portalBody = "登录失败：验证码错误";
  portalFinalUrl = "https://sso.tyust.edu.cn/login";
  const invalidCreated = await createCaptchaSession("user-b", "student-b");
  await assert.rejects(
    () => loginWithCaptcha("user-b", {
      sessionId: invalidCreated.sessionId,
      studentId: "student-b",
      password: "temporary-test-password",
      captcha: "wrong"
    }),
    err => err && err.code === "JWXT_CAPTCHA_INVALID"
  );
  console.log("explicitCaptchaErrorWinsOverGenericLoginFailureTest=passed");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
