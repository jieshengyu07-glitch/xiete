const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const readline = require("readline");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIE_FILE = path.join(DATA_DIR, "cookies.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = q => new Promise(resolve => rl.question(q, resolve));

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
    console.log("Selected JSESSIONID: " + String(state.jSession.value).substring(0, 20) + "...");
  }
}

function validateCookieFile() {
  if (!fs.existsSync(COOKIE_FILE)) {
    return { ok: false, error: "cookies.json does not exist: " + COOKIE_FILE };
  }

  let cookies;
  try {
    cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
  } catch (err) {
    return { ok: false, error: "cookies.json is not valid JSON: " + err.message };
  }

  if (!Array.isArray(cookies)) {
    return { ok: false, error: "cookies.json must be a cookie array" };
  }

  const newjwcCookies = getNewjwcCookies(cookies);
  const jSession = selectJSession(newjwcCookies);

  console.log("\n=== Cookie File Check ===");
  console.log("cookies.json path: " + COOKIE_FILE);
  console.log("newjwc Cookie count: " + newjwcCookies.length);
  console.log("JSESSIONID exists: " + (jSession ? "YES" : "NO"));
  if (jSession) {
    console.log("Selected JSESSIONID domain: " + jSession.domain);
    console.log("Selected JSESSIONID path: " + (jSession.path || ""));
    console.log("Selected JSESSIONID: " + String(jSession.value).substring(0, 20) + "...");
  }

  if (newjwcCookies.length === 0) {
    return { ok: false, error: "No cookie with domain containing newjwc" };
  }
  if (!jSession) {
    return { ok: false, error: "No JSESSIONID cookie in newjwc cookies" };
  }

  return { ok: true, cookies: newjwcCookies, jSession };
}

function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : "";
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: body ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      } : {}
    }, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
        } catch (err) {
          reject(new Error("Invalid JSON response: " + err.message));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(data);
    req.end();
  });
}

(async () => {
  let browser = null;

  try {
    console.log("\n=== Campus Assistant Setup ===\n");

    let renderUrl = process.env.RENDER_URL || "";
    if (!renderUrl) {
      renderUrl = await question("Enter your Render URL (e.g., https://campus.onrender.com): ");
      renderUrl = renderUrl.replace(/\/+$/, "");
    }
    console.log("Target: " + renderUrl);

    console.log("\nStep 1/4: Open portal. Please login manually, then manually enter JWXT.");
    browser = await chromium.launch({ channel: "msedge", headless: false });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto("https://ronghemenhu.tyust.edu.cn/index", { waitUntil: "domcontentloaded" });

    await question("Press Enter AFTER you are inside JWXT (newjwc.tyust.edu.cn/jwglxt).\n");

    const context = page.context();
    const jwxtPage = await findJwxtPage(context);
    if (!jwxtPage) {
      console.log("\nERROR: No open page matched newjwc.tyust.edu.cn with /jwglxt/ and not login_slogin.html. Upload aborted.");
      return;
    }

    const currentUrl = jwxtPage.url();
    const cookies = await context.cookies();
    const state = inspectLoginState(currentUrl, cookies);
    printState(state);

    if (!state.enteredJwxt) {
      console.log("\nERROR: Current URL is not newjwc.tyust.edu.cn/jwglxt. Upload aborted.");
      return;
    }
    if (state.stillLoginPage) {
      console.log("\nERROR: Still on login_slogin.html. Upload aborted.");
      return;
    }
    if (state.newjwcCookies.length === 0) {
      console.log("\nERROR: No newjwc cookies found. Upload aborted.");
      return;
    }
    if (!state.jSession) {
      console.log("\nERROR: No newjwc JSESSIONID found. Upload aborted.");
      return;
    }

    fs.writeFileSync(COOKIE_FILE, JSON.stringify(state.newjwcCookies, null, 2), "utf8");
    console.log("\nStep 2/4: Cookies saved: " + COOKIE_FILE);
    await browser.close();
    browser = null;

    console.log("\nStep 3/4: Validate cookies.json before upload.");
    const checked = validateCookieFile();
    if (!checked.ok) {
      console.log("ERROR: " + checked.error);
      return;
    }

    console.log("\nStep 4/4: Uploading cookies to " + renderUrl + "/upload-cookies");
    const uploadRes = await requestJson("POST", renderUrl + "/upload-cookies", checked.cookies);
    console.log("Upload HTTP status: " + uploadRes.status);
    console.log("Upload result: " + JSON.stringify(uploadRes.data));

    if (uploadRes.data && uploadRes.data.success) {
      console.log("Upload OK. JSESSIONID present: " + (uploadRes.data.hasJSession ? "YES" : "NO"));
    } else {
      console.log("Upload failed or warned: " + JSON.stringify(uploadRes.data));
    }

    const statusRes = await requestJson("GET", renderUrl + "/status");
    console.log("Status HTTP status: " + statusRes.status);
    console.log("Status result: " + JSON.stringify(statusRes.data));
  } catch (err) {
    console.log("ERROR: " + err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    rl.close();
  }
})();
