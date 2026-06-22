const { chromium } = require("playwright-core");
const readline = require("readline");

const PORTAL_URL = "https://ronghemenhu.tyust.edu.cn/index";
const POST_DATA_PREVIEW_LENGTH = 300;
const KEYWORDS = [
  "newjwc",
  "jwglxt",
  "rjurl",
  "ticket",
  "service",
  "portal",
  "app",
  "sso"
];

const state = {
  sawNewjwc: false,
  sawRjurl: false,
  enteredJwglxt: false,
  matchedUrls: []
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function waitForEnter(message) {
  return new Promise(resolve => rl.question(message, () => resolve()));
}

function now() {
  return new Date().toISOString();
}

function log(label, message) {
  console.log("[" + now() + "] " + label + " " + message);
}

function shouldPrint(url) {
  const text = String(url || "").toLowerCase();
  return KEYWORDS.some(keyword => text.includes(keyword));
}

function updateState(url) {
  const text = String(url || "").toLowerCase();
  if (text.includes("newjwc")) state.sawNewjwc = true;
  if (text.includes("rjurl")) state.sawRjurl = true;
  if (text.includes("jwglxt")) state.enteredJwglxt = true;
  if (shouldPrint(url)) state.matchedUrls.push(url);
}

function printPostData(request) {
  const postData = request.postData();
  if (!postData) return;

  console.log("request.postData first " + POST_DATA_PREVIEW_LENGTH + " chars:");
  console.log(String(postData).slice(0, POST_DATA_PREVIEW_LENGTH));
}

async function printRequest(request) {
  const url = request.url();
  if (!shouldPrint(url)) return;

  updateState(url);
  log("REQ", request.method() + " " + url);
  printPostData(request);
}

async function printResponse(response) {
  const url = response.url();
  if (!shouldPrint(url)) return;

  updateState(url);
  const request = response.request();
  const status = response.status();
  log("RES", request.method() + " " + status + " " + url);

  if (status >= 300 && status < 400) {
    const headers = response.headers();
    console.log("3xx Location: " + (headers.location || "(none)"));
  }
}

function cookieNamesForDomain(cookies, domainText) {
  return cookies
    .filter(cookie => String(cookie.domain || "").includes(domainText))
    .map(cookie => cookie.name);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function launchBrowser() {
  const channel = process.env.PLAYWRIGHT_CHANNEL || "msedge";
  return chromium.launch({
    channel,
    headless: false
  });
}

(async () => {
  let browser;

  try {
    console.log("=== Capture JWXT App Click ===");
    console.log("This script opens the portal and traces URLs after you click the JWXT app.");
    console.log("No cookies are saved. No data is uploaded. Cookie values are never printed.\n");
    console.log("Matched keywords: " + KEYWORDS.join(", ") + "\n");

    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 }
    });

    context.on("page", page => {
      log("PAGE", "new tab/page opened");
      page.on("domcontentloaded", () => {
        const url = page.url();
        updateState(url);
        if (shouldPrint(url)) log("PAGE", "domcontentloaded " + url);
      });
    });

    context.on("request", request => {
      printRequest(request).catch(error => {
        console.log("request trace failed: " + error.message);
      });
    });

    context.on("response", response => {
      printResponse(response).catch(error => {
        console.log("response trace failed: " + error.message);
      });
    });

    const page = await context.newPage();
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });

    console.log("Portal opened.");
    console.log("Steps:");
    console.log("1. Manually log in to the portal.");
    console.log("2. Manually click the JWXT / teaching affairs app.");
    console.log("3. Wait until the new page or tab stops loading.");
    await waitForEnter("\nPress Enter here after clicking the JWXT app and waiting for redirects.\n");

    await page.waitForTimeout(2000).catch(() => {});

    const cookies = await context.cookies();
    const newjwcCookieNames = unique(cookieNamesForDomain(cookies, "newjwc"));

    console.log("\n=== Final Diagnosis ===");
    console.log("Saw newjwc: " + (state.sawNewjwc ? "YES" : "NO"));
    console.log("Saw rjurl: " + (state.sawRjurl ? "YES" : "NO"));
    console.log("Entered jwglxt: " + (state.enteredJwglxt ? "YES" : "NO"));
    console.log("newjwc cookie names: " + (newjwcCookieNames.length ? newjwcCookieNames.join(", ") : "(none)"));

    const urls = unique(state.matchedUrls);
    console.log("\n=== Matched URLs ===");
    if (urls.length === 0) {
      console.log("(none)");
    } else {
      urls.forEach((url, index) => console.log((index + 1) + ". " + url));
    }
  } catch (error) {
    console.error("ERROR: " + error.stack);
    process.exitCode = 1;
  } finally {
    rl.close();
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
})();
