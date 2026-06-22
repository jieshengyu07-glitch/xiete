const axios = require("axios");
const readline = require("readline");
const { httpJwxtLogin } = require("./login/httpJwxtLogin");

const JWXT_ORIGIN = "https://newjwc.tyust.edu.cn";
const JWXT_HOME_URL = JWXT_ORIGIN + "/jwglxt/xtgl/index_initMenu.html";
const GRADE_PAGE_URL = JWXT_ORIGIN + "/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default";
const GRADE_QUERY_URL = JWXT_ORIGIN + "/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005";
const TERMS = [
  { xnm: "2023", xqm: "3" },
  { xnm: "2023", xqm: "12" },
  { xnm: "2024", xqm: "3" },
  { xnm: "2024", xqm: "12" },
  { xnm: "2025", xqm: "3" },
  { xnm: "2025", xqm: "12" }
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question);

  return new Promise(resolve => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(char) {
      if (char === "\r" || char === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u0003") {
        cleanup();
        stdout.write("\n");
        process.exit(130);
      }

      if (char === "\b" || char === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      value += char;
      stdout.write("*");
    }

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on("data", onData);
  });
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
}

function cookieNamesForDomain(cookies, domainText) {
  return Array.from(new Set(
    cookies
      .filter(cookie => String(cookie.domain || "").includes(domainText))
      .map(cookie => cookie.name)
  ));
}

function isJwglxtPath(path) {
  return path === "/jwglxt" || String(path || "").startsWith("/jwglxt/");
}

function findCookie(cookies, name, pathMatcher) {
  return cookies.find(cookie =>
    cookie.domain === "newjwc.tyust.edu.cn" &&
    cookie.name === name &&
    pathMatcher(cookie.path)
  );
}

function buildGradeCookieSet(cookies) {
  const route = findCookie(cookies, "route", path => path === "/");
  const jsession = findCookie(cookies, "JSESSIONID", isJwglxtPath);
  const rememberMe = findCookie(cookies, "rememberMe", isJwglxtPath);
  const selected = [route, jsession, rememberMe].filter(Boolean);

  console.log("Grade query Cookie set:");
  if (!selected.length) {
    console.log("(none)");
  } else {
    selected.forEach(cookie => {
      console.log("- name=" + cookie.name + " path=" + cookie.path);
    });
  }

  if (!route) throw new Error("Missing newjwc route cookie with path=/.");
  if (!jsession) throw new Error("Missing newjwc JSESSIONID cookie with path=/jwglxt.");
  if (!rememberMe) throw new Error("Missing newjwc rememberMe cookie with path=/jwglxt.");

  return {
    cookies: selected,
    header: selected.map(cookie => cookie.name + "=" + cookie.value).join("; ")
  };
}

function gradeCountFromResponse(data) {
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (error) {}
  }
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.items)) return data.items.length;
  if (data && Array.isArray(data.rows)) return data.rows.length;
  return null;
}

async function requestWithGradeCookies(method, url, cookieHeader, options) {
  return axios({
    method,
    url,
    data: options && options.data,
    headers: Object.assign({}, options && options.headers, {
      "User-Agent": userAgent(),
      "Cookie": cookieHeader
    }),
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: options && options.timeout ? options.timeout : 30000
  });
}

async function queryGrades(gradeCookieHeader) {
  let total = 0;

  await requestWithGradeCookies("GET", GRADE_PAGE_URL, gradeCookieHeader, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": JWXT_HOME_URL
    },
    timeout: 20000
  });

  for (const term of TERMS) {
    const body = new URLSearchParams({
      xnm: term.xnm,
      xqm: term.xqm,
      page: "1",
      rows: "100"
    }).toString();

    const response = await requestWithGradeCookies("POST", GRADE_QUERY_URL, gradeCookieHeader, {
      data: body,
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": GRADE_PAGE_URL
      },
      timeout: 30000
    });

    const count = gradeCountFromResponse(response.data);
    if (count === null) {
      console.log(term.xnm + "-" + term.xqm + " count=ERROR status=" + response.status);
      continue;
    }

    total += count;
    console.log(term.xnm + "-" + term.xqm + " count=" + count);
  }

  console.log("Total grades: " + total);
}

(async () => {
  try {
    const studentId = await ask("Student ID: ");
    const password = await askSecret("Password: ");

    const login = await httpJwxtLogin(studentId, password, { debug: true });
    const newjwcCookieNames = cookieNamesForDomain(login.cookies, "newjwc");

    console.log("HTTP JWXT login success: " + (login.success ? "YES" : "NO"));
    console.log("Final URL: " + login.finalUrl);
    console.log("newjwc cookie names: " + (newjwcCookieNames.join(", ") || "(none)"));
    console.log("JWXT JSESSIONID: " + (login.jwxtJSessionId ? "YES" : "NO"));

    console.log("\n=== Grade Query ===");
    const gradeCookieSet = buildGradeCookieSet(login.cookies);
    await queryGrades(gradeCookieSet.header);
  } catch (error) {
    console.error("ERROR: " + error.message);
    process.exitCode = 1;
  }
})();
