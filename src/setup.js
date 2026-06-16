const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");

const DATA_DIR = path.join(__dirname, "..", "data");
const COOKIE_FILE = path.join(DATA_DIR, "cookies.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = q => new Promise(r => rl.question(q, r));

function httpPost(url, body) {
  return new Promise(resolve => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
    req.write(data); req.end();
  });
}

function httpGet(url) {
  return new Promise(resolve => {
    http.get(url, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
  });
}

(async () => {
  console.log("\n=== \uD83D\uDE80 Campus Assistant Setup ===\n");

  // 1. Get Render URL
  let renderUrl = process.env.RENDER_URL || "";
  if (!renderUrl) {
    renderUrl = await question("Enter your Render URL (e.g., https://campus.onrender.com): ");
    renderUrl = renderUrl.replace(/\/+$/, ""); // trim trailing slash
  }
  console.log("Target: " + renderUrl + "\n");

  // 2. Browser login
  console.log("Step 1/4: Open browser for login...");
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://ronghemenhu.tyust.edu.cn/index");
  await question("  Press Enter AFTER logging in and reaching the portal.\n");

  console.log("  In the browser, click the \u6559\u52a1\u7cfb\u7edf app icon on the portal page.");
  console.log("  (This triggers SSO - you should reach JWXT main page with your name visible)");
  await question("  Press Enter AFTER reaching JWXT main page.\n");

  // 3. Save cookies
  const cookies = await page.context().cookies();
  const jSession = cookies.find(c => c.name === "JSESSIONID" && c.domain.includes("newjwc"));
  if (!jSession) {
    console.log("\n\u274C No JSESSIONID found. Login failed or SSO incomplete.\n");
    await browser.close(); rl.close(); return;
  }
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log("Step 2/4: \u2705 Cookies saved (JSESSIONID: " + jSession.value.substring(0, 20) + "...)");
  await browser.close();

  // 4. Upload to Render
  console.log("Step 3/4: Uploading cookies to " + renderUrl + "...");
  try {
    const uploadRes = await httpPost(renderUrl + "/upload-cookies", cookies);
    if (uploadRes.data.success) {
      console.log("  \u2705 Upload OK (" + uploadRes.data.count + " cookies" + (uploadRes.data.hasJSession ? ", JSESSIONID present" : "") + ")");
    } else {
      console.log("  \u26A0\uFE0F Upload warning: " + (uploadRes.data.message || uploadRes.data.error));
    }
  } catch (e) {
    console.log("  \u274C Upload failed: " + e.message);
    await rl.close(); return;
  }

  // 5. Verify
  console.log("Step 4/4: Verifying /status...");
  try {
    const statusRes = await httpGet(renderUrl + "/status");
    const s = statusRes.data;
    if (s.cookieValid) {
      console.log("  \u2705 cookieValid: true \u2192 System ready!");
    } else {
      console.log("  \u26A0\uFE0F cookieValid: false \u2014 cookies may have expired");
    }
    console.log("  Total grades: " + s.totalGrades);
    console.log("  Status: " + s.status);
  } catch (e) {
    console.log("  \u274C Status check failed: " + e.message);
  }

  console.log("\n=== \u2705 Setup complete ===");
  console.log("Run \u201Cnpm start\u201D to start the server locally");
  rl.close();
})();
