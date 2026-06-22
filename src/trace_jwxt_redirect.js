const { chromium } = require("playwright-core");
const readline = require("readline");

const PORTAL_URL = "https://ronghemenhu.tyust.edu.cn/index";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = msg => new Promise(resolve => rl.question(msg, () => resolve()));

const state = {
  enteredJwxt: false,
  sawTicket: false,
  sawRjurl: false,
  ticketUrls: [],
  redirectLocations: []
};

function now() {
  return new Date().toISOString();
}

function log(type, message) {
  console.log("[" + now() + "] [" + type + "] " + message);
}

function shouldTrace(url) {
  return /newjwc|jwglxt|sso1|rjurl|ticket|service/i.test(String(url || ""));
}

function mark(url) {
  const s = String(url || "");
  if (s.includes("/jwglxt")) state.enteredJwxt = true;
  if (/ticket/i.test(s)) {
    state.sawTicket = true;
    state.ticketUrls.push(s);
  }
  if (/rjurl/i.test(s)) state.sawRjurl = true;
}

function logPostData(request) {
  if (request.method() !== "POST") return;
  const data = request.postData() || "";
  if (!data) {
    log("POST", "postData: (empty)");
    return;
  }
  log("POST", "postData first 500 chars: " + data.substring(0, 500));
}

function shortCookieValue(value) {
  if (!value) return "";
  return String(value).substring(0, 8) + "...";
}

(async () => {
  let browser = null;

  try {
    console.log("=== JWXT Redirect Trace ===");
    console.log("Open portal, login manually, then click JWXT.");
    console.log("This script only traces redirects/requests. It does not save cookies or upload data.\n");

    browser = await chromium.launch({ channel: "msedge", headless: false });
    const page = await browser.newPage();

    page.on("framenavigated", frame => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        mark(url);
        log("NAV", url);
      }
    });

    page.on("request", request => {
      const url = request.url();
      mark(url);
      if (shouldTrace(url)) {
        log("REQ", request.method() + " " + url);
        if (/ticket/i.test(url)) log("TICKET", url);
        logPostData(request);
      }
    });

    page.on("response", response => {
      const url = response.url();
      const status = response.status();
      const request = response.request();
      mark(url);
      if (shouldTrace(url)) {
        log("RES", request.method() + " " + status + " " + url);
        if (/ticket/i.test(url)) log("TICKET", url);
      }
      if (status >= 300 && status < 400) {
        const headers = response.headers();
        const location = headers.location || headers.Location || "";
        const line = status + " " + url + " -> " + (location || "(no location)");
        state.redirectLocations.push(line);
        log("3XX", line);
      }
    });

    page.on("requestfailed", request => {
      const url = request.url();
      mark(url);
      const failure = request.failure();
      log("FAIL", url + " :: " + (failure ? failure.errorText : "unknown"));
    });

    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });

    await waitEnter("Press Enter after you have clicked JWXT. The script will wait 10 more seconds.\n");
    log("WAIT", "Waiting 10 seconds for remaining redirects...");
    await page.waitForTimeout(10000);

    const finalUrl = page.url();
    const finalTitle = await page.title().catch(() => "");
    const cookies = await page.context().cookies();
    const newjwcCookies = cookies.filter(c => String(c.domain || "").includes("newjwc"));
    const jsessions = newjwcCookies.filter(c => c.name === "JSESSIONID");

    console.log("\n=== Final Diagnosis ===");
    console.log("Final URL: " + finalUrl);
    console.log("Final Title: " + finalTitle);
    console.log("Contains login_slogin.html: " + (finalUrl.includes("login_slogin.html") ? "YES" : "NO"));
    console.log("Entered /jwglxt: " + (state.enteredJwxt ? "YES" : "NO"));
    console.log("Saw ticket: " + (state.sawTicket ? "YES" : "NO"));
    console.log("Saw rjurl: " + (state.sawRjurl ? "YES" : "NO"));
    console.log("newjwc Cookie count: " + newjwcCookies.length);

    if (jsessions.length === 0) {
      console.log("JSESSIONID: NONE");
    } else {
      jsessions.forEach((c, i) => {
        console.log(
          "JSESSIONID #" + (i + 1) +
          " domain=" + c.domain +
          " path=" + (c.path || "") +
          " value=" + shortCookieValue(c.value)
        );
      });
    }

    console.log("\n=== Ticket URLs ===");
    if (state.ticketUrls.length === 0) {
      console.log("(none)");
    } else {
      state.ticketUrls.forEach((url, i) => console.log((i + 1) + ". " + url));
    }

    console.log("\n=== 3xx Locations ===");
    if (state.redirectLocations.length === 0) {
      console.log("(none)");
    } else {
      state.redirectLocations.forEach((line, i) => console.log((i + 1) + ". " + line));
    }
  } catch (err) {
    console.log("ERROR: " + err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    rl.close();
  }
})();
