const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

(async () => {
  console.log("=== \u81ea\u52a8\u767b\u5f55\u5de5\u5177 ===");
  console.log("\u6b63\u5728\u542f\u52a8\u6d4f\u89c8\u5668...\n");
  const studentId = process.env.JWXT_STUDENT_ID || "";
  const password = process.env.JWXT_PASSWORD || "";
  if (!studentId || !password) {
    console.log("ERROR: Please set JWXT_STUDENT_ID and JWXT_PASSWORD before running this script.");
    return;
  }

  const browser = await chromium.launch({ channel: "msedge", headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // 1. CAS \u767b\u5f55
  console.log("1/4 CAS \u767b\u5f55...");
  await page.goto("https://sso1.tyust.edu.cn/login?service=https%3A%2F%2Fsso1.tyust.edu.cn%2Foauth2.0%2FcallbackAuthorize%3Fclient_id%3Drhmh%26redirect_uri%3Dhttps%253A%252F%252Fronghemenhu.tyust.edu.cn%252Fsso%252Flogin%26response_type%3Dcode%26client_name%3DCasOAuthClient");
  await page.waitForTimeout(2000);
  await page.locator("input").nth(0).fill(studentId);
  await page.locator("input").nth(1).fill(password);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(8000);
  console.log("   CAS \u767b\u5f55\u5b8c\u6210");

  // 2. \u878d\u5408\u95e8\u6237
  console.log("2/4 \u8fdb\u5165\u878d\u5408\u95e8\u6237...");
  await page.goto("https://ronghemenhu.tyust.edu.cn/index", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  console.log("   \u95e8\u6237\u5df2\u52a0\u8f7d");

  // 3. \u70b9\u51fb\u6559\u52a1\u7cfb\u7edf\u5e94\u7528
  console.log("3/4 \u70b9\u51fb\u6559\u52a1\u7cfb\u7edf...");
  try {
    await page.getByAltText("\u6559\u52a1\u7cfb\u7edf").click({ timeout: 5000 });
    console.log("   \u70b9\u51fb\u6210\u529f");
  } catch {
    console.log("   \u5c1d\u8bd5\u5907\u9009\u9009\u62e9\u5668...");
    try { await page.locator("img[alt*=\u6559\u52a1]").click({ timeout: 3000 }); console.log("   \u5907\u9009\u6210\u529f"); }
    catch { console.log("   \u81ea\u52a8\u70b9\u51fb\u5931\u8d25\uff0c\u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u70b9\u51fb\u300c\u6559\u52a1\u7cfb\u7edf\u300d\u5e94\u7528"); }
  }
  await page.waitForTimeout(5000);

  // 4. \u7b49\u5f85 SSO \u5b8c\u6210
  console.log("4/4 \u7b49\u5f85 SSO...");
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (url.includes("index_initMenu")) { console.log("   \u6559\u52a1\u7cfb\u7edf SSO \u6210\u529f"); break; }
    try {
      const body = await page.evaluate(() => document.body.innerText.substring(0, 100)).catch(() => "");
      if (body.includes("\u89e3\u5723\u5b87")) { console.log("   \u5df2\u8bc6\u522b\u7528\u6237\u8eab\u4efd"); break; }
    } catch {}
    if (i === 15) console.log("   \u5c1a\u672a\u5b8c\u6210\uff0c\u7ee7\u7eed\u7b49\u5f85...");
  }

  // \u4fdd\u5b58 cookies
  const cookies = await page.context().cookies();
  const jSession = cookies.find(c => c.name === "JSESSIONID" && c.domain.includes("newjwc"));
  if (jSession) {
    fs.writeFileSync(path.join(DATA_DIR, "cookies.json"), JSON.stringify(cookies, null, 2));
    console.log("\n\\u2705 JSESSIONID: present (value hidden)");
    console.log("\u2705 Cookies \u5df2\u4fdd\u5b58\u5230 data/cookies.json");
    console.log("\n\u73b0\u5728\u53ef\u4ee5\u8fd0\u884c\u4ee5\u4e0b\u547d\u4ee4\u542f\u52a8\u670d\u52a1\u5668: npm start");
  } else {
    console.log("\n\u274c \u672a\u83b7\u53d6\u5230 JSESSIONID");
    console.log("\u8bf7\u786e\u8ba4\u5df2\u6210\u529f\u8fdb\u5165\u6559\u52a1\u7cfb\u7edf\u4e3b\u9875");
  }


  
  // Extract grades
  console.log("\n????????...");
  try {
    await page.goto("https://newjwc.tyust.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",{waitUntil:"networkidle"});
    await page.waitForTimeout(3000);
    if(!page.url().includes("login_slogin")){
      await page.evaluate(function(){
        var btns=document.querySelectorAll("button");
        for(var b=0;b<btns.length;b++){if(btns[b].textContent.indexOf('\u67e5')>=0&&btns[b].textContent.indexOf('\u8be2')>=0){btns[b].click();return;}}
      });
      await page.waitForTimeout(3000);
      var gradesRaw=JSON.parse(await page.evaluate(function(){return JSON.stringify(Array.from(document.querySelectorAll('[role="gridcell"][title]')).map(function(c){return c.getAttribute("title");}));}));
      if(gradesRaw.length>0){
        var rowSize=16;var rows=[];
        for(var i=0;i<gradesRaw.length;i+=rowSize){if(i+rowSize<=gradesRaw.length)rows.push(gradesRaw.slice(i,i+rowSize));}
        var formatted=rows.map(function(row){var obj={};var keys=["XNM","XQM","KCH","KCMC","KCXZ","XF","CJ","CJBJ","JD","CJXZ","KKXY","JSXX","KHFS","XH","XM"];for(var k=0;k<keys.length&&k<row.length;k++)obj[keys[k]]=row[k];return obj;});
        require("./db/storage").mergeGrades(formatted);
        console.log("? ??? "+rows.length+" ?????");
      }
    }
  } catch(e){console.log("??????: "+e.message);}
await browser.close();
})();
