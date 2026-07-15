const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const DATA_DIR = config.dataDir;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

(async () => {
  console.log("=== \u622a\u53d6\u6210\u7ee9\u6570\u636e ===\n");

  // 1. \u8bfb\u53d6 cookies
  const cookieFile = path.join(DATA_DIR, "cookies.json");
  if (!fs.existsSync(cookieFile)) {
    console.log("\u274c \u672a\u627e\u5230 cookies\uff0c\u8bf7\u5148\u8fd0\u884c npm run auto-login");
    return;
  }
  const cookiesData = JSON.parse(fs.readFileSync(cookieFile, "utf8"));

  // 2. \u542f\u52a8\u6d4f\u89c8\u5668
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookiesData.map(c => ({
    name: c.name, value: c.value, domain: c.domain || "newjwc.tyust.edu.cn",
    path: c.path || "/", httpOnly: true, secure: true, sameSite: "Lax",
  })));
  const page = await context.newPage();

  // 3. \u8bbf\u95ee\u6210\u7ee9\u9875\u9762
  console.log("1/3 \u8bbf\u95ee\u6210\u7ee9\u9875\u9762...");
  await page.goto("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  console.log("    URL: " + page.url().substring(0, 80));

  if (page.url().includes("login_slogin")) {
    console.log("\u274c Session \u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8fd0\u884c npm run auto-login");
    await browser.close(); return;
  }

  // 4. \u70b9\u51fb\u67e5\u8be2
  console.log("2/3 \u70b9\u51fb\u67e5\u8be2...");
  await page.evaluate(() => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      if (b.textContent.includes("\u67e5") && b.textContent.includes("\u8be2")) {
        b.click(); return;
      }
    }
  });
  await page.waitForTimeout(3000);

  // 5. \u63d0\u53d6\u6570\u636e
  console.log("3/3 \u63d0\u53d6\u6210\u7ee9...");
  const grades = await page.evaluate(() => {
    const cells = document.querySelectorAll('[role="gridcell"][title]');
    const result = [];
    cells.forEach(c => {
      result.push({ field: c.getAttribute("title"), text: c.textContent.trim() });
    });
    return result;
  });

  // \u7ec4\u7ec7\u6570\u636e
  const rowSize = 16;
  const rows = [];
  for (let i = 0; i < grades.length; i += rowSize) {
    if (i + rowSize <= grades.length) rows.push(grades.slice(i, i + rowSize));
  }

  console.log("    \u83b7\u53d6\u5230 " + rows.length + " \u95e8\u8bfe\u7a0b");

  if (rows.length > 0) {
    // \u4fdd\u5b58\u5230 storage
    const storage = require("./db/storage");
    const formatted = rows.map(row => {
      var obj = {};
      var keys = ["XNM","XQM","KCH","KCMC","KCXZ","XF","CJ","CJBJ","JD","CJXZ","KKXY","JSXX","KHFS","XH","XM"];
      row.forEach(function(r, idx) {
        if (idx < keys.length) obj[keys[idx]] = r.field;
      });
      return obj;
    });
    storage.mergeGrades(formatted);
    console.log("    \u6210\u7ee9\u5df2\u4fdd\u5b58\u5230\u672c\u5730\u5b58\u50a8");
  } else {
    console.log("    \u6682\u65e0\u6210\u7ee9\u6570\u636e");
  }

  await browser.close();
  console.log("\n=== \u5b8c\u6210 ===");
})();
