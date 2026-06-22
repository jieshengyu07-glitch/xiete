const { chromium } = require("playwright-core");
const readline = require("readline");

const PORTAL_URL = "https://ronghemenhu.tyust.edu.cn/index";
const TARGET_PATTERN = "cjcx_cxXsgrcj.html?doType=query";
const RESPONSE_PREVIEW_LENGTH = 500;

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

function log(message) {
  console.log("[" + now() + "] " + message);
}

function isTargetGradeQuery(request) {
  return request.method() === "POST" && request.url().includes(TARGET_PATTERN);
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
    console.log("=== Capture Grade Request ===");
    console.log("Open portal, then manually log in and navigate to JWXT grade query.");
    console.log("Listening for: POST " + TARGET_PATTERN);
    console.log("No cookies are saved. No data is uploaded. Business code is untouched.\n");

    browser = await launchBrowser();

    // Non-persistent browser context: no userDataDir and no storageState output.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 }
    });

    context.on("request", request => {
      if (!isTargetGradeQuery(request)) return;

      log("Captured grade query request");
      console.log("request.url(): " + request.url());
      console.log("request.method(): " + request.method());
      console.log("request.postData():");
      console.log(request.postData() || "");
      console.log("");
    });

    context.on("response", async response => {
      const request = response.request();
      if (!isTargetGradeQuery(request)) return;

      log("Captured grade query response");
      console.log("response.status(): " + response.status());
      console.log("response body first " + RESPONSE_PREVIEW_LENGTH + " chars:");

      try {
        const body = await response.text();
        console.log(String(body || "").slice(0, RESPONSE_PREVIEW_LENGTH));
      } catch (error) {
        console.log("Failed to read response body: " + error.message);
      }

      console.log("");
    });

    const page = await context.newPage();
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });

    console.log("Portal opened. In the browser, manually complete these steps:");
    console.log("1. Log in to the portal.");
    console.log("2. Enter JWXT.");
    console.log("3. Open the student grade query page.");
    console.log("4. Select school year 2025-2026 and term 1, then click query.\n");
    console.log("The script keeps listening across all tabs in this browser context.");

    await waitForEnter("After the request is captured, press Enter here to exit.\n");
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
