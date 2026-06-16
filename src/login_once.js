const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = msg => new Promise(r => rl.question(msg, () => r()));
(async () => {
  console.log("=== Login Once Tool ===\nStep 1: Open browser for manual login");
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  const page = await browser.newPage();
  await page.goto("https://ronghemenhu.tyust.edu.cn/index");
  await waitEnter("Press Enter after logging in and reaching the portal.\nStep 2: Open JWXT");
  await page.goto("https://newjwc.tyust.edu.cn/jwglxt/xtgl/index_initMenu.html?jsdm=xs").catch(()=>{});
  await waitEnter("Press Enter after reaching JWXT main page.\n");
  const cookies = await page.context().cookies();
  const j = cookies.find(c => c.name === "JSESSIONID" && c.domain.includes("newjwc"));
  if (j) {
    fs.writeFileSync(path.join(dataDir, "cookies.json"), JSON.stringify(cookies, null, 2));
    console.log("JSESSIONID: " + j.value.substring(0, 20) + "...\nCookies saved. Run: npm start");
  } else console.log("No JSESSIONID found - try again from step 2");
  await browser.close();
  rl.close();
})();
