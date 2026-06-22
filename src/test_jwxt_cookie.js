const { chromium } = require("playwright-core");
const axios = require("axios");
const readline = require("readline");

const PORTAL_URL = "https://ronghemenhu.tyust.edu.cn/index";
const GRADE_URL = "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query";
const REFERER_URL = "https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = msg => new Promise(resolve => rl.question(msg, () => resolve()));

function getNewjwcCookies(cookies) {
  return cookies.filter(c => String(c.domain || "").includes("newjwc"));
}

function buildCookieHeader(cookies) {
  return cookies.map(c => c.name + "=" + c.value).join("; ");
}

function hasLoginHtml(text) {
  return text.includes("login_slogin.html") ||
    text.includes("用户登录") ||
    text.includes("用户名") ||
    text.includes("<html");
}

function hasNoPermission(text) {
  return text.includes("未登录") ||
    text.includes("无权限") ||
    text.includes("未授权") ||
    text.includes("请先登录") ||
    text.includes("session") ||
    text.includes("Session");
}

(async () => {
  let browser = null;

  try {
    console.log("=== JWXT Cookie Test ===");
    console.log("Opening portal. Please login manually and click JWXT.");

    browser = await chromium.launch({ channel: "msedge", headless: false });
    const page = await browser.newPage();
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });

    await waitEnter("Press Enter after clicking JWXT, even if the final page is login_slogin.html.\n");

    const currentUrl = page.url();
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "Mozilla/5.0");
    const cookies = await page.context().cookies();
    const newjwcCookies = getNewjwcCookies(cookies);
    const jsession = newjwcCookies.find(c => c.name === "JSESSIONID");
    const cookieHeader = buildCookieHeader(newjwcCookies);

    console.log("\n=== Browser State ===");
    console.log("Current URL: " + currentUrl);
    console.log("newjwc Cookie count: " + newjwcCookies.length);
    console.log("JSESSIONID exists: " + (jsession ? "YES" : "NO"));
    if (jsession) {
      console.log("JSESSIONID domain: " + jsession.domain);
      console.log("JSESSIONID path: " + (jsession.path || ""));
      console.log("JSESSIONID value: " + String(jsession.value).substring(0, 20) + "...");
    }

    if (!cookieHeader) {
      console.log("\nERROR: No newjwc cookies found. Cannot test grade API.");
      return;
    }

    const body = new URLSearchParams({
      xnm: "2025",
      xqm: "12",
      _search: "false",
      nd: String(Date.now()),
      "queryModel.showCount": "100",
      "queryModel.currentPage": "1",
      "queryModel.sortName": "",
      "queryModel.sortOrder": "asc",
      time: "0"
    }).toString();

    console.log("\n=== Request ===");
    console.log("POST " + GRADE_URL);
    console.log("Referer: " + REFERER_URL);

    const resp = await axios.post(GRADE_URL, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": REFERER_URL,
        "User-Agent": userAgent,
        "Cookie": cookieHeader
      },
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 30000
    });

    const text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    const preview = String(text || "").slice(0, 1000);

    console.log("\n=== Response ===");
    console.log("HTTP status: " + resp.status);
    console.log("Response first 1000 chars:");
    console.log(preview);

    console.log("\n=== Diagnosis ===");
    if (text.includes("items") || text.includes("KCMC") || text.includes("kcmc")) {
      console.log("Cookie usable: response looks like grade JSON/items.");
    } else if (hasLoginHtml(text)) {
      console.log("Cookie unusable: response is login/html page.");
    } else if (hasNoPermission(text)) {
      console.log("Cookie unusable: response says not logged in or no permission.");
    } else {
      console.log("Cookie status unclear: inspect HTTP status and response preview above.");
    }
  } catch (err) {
    console.log("ERROR: " + err.message);
    if (err.response) {
      console.log("HTTP status: " + err.response.status);
      console.log(String(err.response.data || "").slice(0, 1000));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    rl.close();
  }
})();
