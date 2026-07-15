const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const config = require("./config");

const dataDir = config.dataDir;
const cookieFile = path.join(dataDir, "cookies.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = msg => new Promise(resolve => rl.question(msg, () => resolve()));

function getNewjwcCookies(cookies) {
  return cookies.filter(c => String(c.domain || "").includes("newjwc"));
}

function selectJSession(cookies) {
  const sessions = cookies.filter(c => c.name === "JSESSIONID");
  return sessions.find(c => String(c.path || "").includes("/jwglxt")) || sessions[0] || null;
}

function isJwxtPageUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    return url.hostname === "newjwc.tyust.edu.cn" &&
      url.pathname.includes("/jwglxt/") &&
      !pageUrl.includes("login_slogin.html");
  } catch (e) {
    return false;
  }
}

async function findJwxtPage(context) {
  const pages = context.pages();
  let jwxtPage = null;

  console.log("\n=== Open Pages ===");
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const title = await p.title().catch(() => "");
    const url = p.url();
    console.log("[" + i + "] title: " + title);
    console.log("[" + i + "] url: " + url);
    if (!jwxtPage && isJwxtPageUrl(url)) jwxtPage = p;
  }

  return jwxtPage;
}

function inspectLoginState(currentUrl, cookies) {
  const newjwcCookies = getNewjwcCookies(cookies);
  const jSession = selectJSession(newjwcCookies);
  let enteredJwxt = false;
  try {
    const url = new URL(currentUrl);
    enteredJwxt = url.hostname === "newjwc.tyust.edu.cn" && url.pathname.includes("/jwglxt/");
  } catch (e) {}
  const stillLoginPage = currentUrl.includes("login_slogin.html");

  return {
    currentUrl,
    enteredJwxt,
    stillLoginPage,
    newjwcCookies,
    jSession
  };
}

function printState(state) {
  console.log("\n=== Login State ===");
  console.log("Current URL: " + state.currentUrl);
  console.log("Entered JWXT: " + (state.enteredJwxt ? "YES" : "NO"));
  console.log("Still on login_slogin.html: " + (state.stillLoginPage ? "YES" : "NO"));
  console.log("newjwc Cookie count: " + state.newjwcCookies.length);
  console.log("JSESSIONID exists: " + (state.jSession ? "YES" : "NO"));
  if (state.jSession) {
    console.log("Selected JSESSIONID domain: " + state.jSession.domain);
    console.log("Selected JSESSIONID path: " + (state.jSession.path || ""));
    console.log("Selected JSESSIONID: present (value hidden)");
  }
}

(async () => {
  let browser = null;

  try {
    console.log("=== Login Once Tool ===");
    console.log("Step 1: Open portal. Please login manually, then manually enter JWXT.");

    browser = await chromium.launch({ channel: "msedge", headless: false });
    const page = await browser.newPage();
    await page.goto("https://ronghemenhu.tyust.edu.cn/index", { waitUntil: "domcontentloaded" });

    await waitEnter("Press Enter AFTER you are inside JWXT (newjwc.tyust.edu.cn/jwglxt).\n");

    const context = page.context();
    const jwxtPage = await findJwxtPage(context);
    if (!jwxtPage) {
      console.log("\nERROR: No open page matched newjwc.tyust.edu.cn with /jwglxt/ and not login_slogin.html.");
      return;
    }

    const currentUrl = jwxtPage.url();
    const cookies = await context.cookies();
    const state = inspectLoginState(currentUrl, cookies);
    printState(state);

    if (!state.enteredJwxt) {
      console.log("\nERROR: Current URL is not newjwc.tyust.edu.cn/jwglxt. Please enter JWXT manually and retry.");
      return;
    }
    if (state.stillLoginPage) {
      console.log("\nERROR: Still on login_slogin.html. JWXT session is not authenticated.");
      return;
    }
    if (state.newjwcCookies.length === 0) {
      console.log("\nERROR: No newjwc cookies found. Cookie save aborted.");
      return;
    }
    if (!state.jSession) {
      console.log("\nERROR: No newjwc JSESSIONID found. Cookie save aborted.");
      return;
    }

    fs.writeFileSync(cookieFile, JSON.stringify(state.newjwcCookies, null, 2), "utf8");
    console.log("\nCookies saved: " + cookieFile);
    console.log("Run: npm start");
  } catch (err) {
    console.log("ERROR: " + err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    rl.close();
  }
})();
