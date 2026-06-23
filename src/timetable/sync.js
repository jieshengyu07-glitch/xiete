const axios = require("axios");
const { loadCookies, writeCookies } = require("../checker");
const { httpJwxtLogin } = require("../login/httpJwxtLogin");
const credentialStore = require("../services/credentialStore");
const { loadConfiguredTerm } = require("./calendar");

const JWXT_BASE = "https://newjwc.tyust.edu.cn/jwglxt";
const TIMETABLE_PAGE = JWXT_BASE + "/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151&layout=default";
const TIMETABLE_QUERY = JWXT_BASE + "/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151";

function isJwglxtPath(cookiePath) {
  return cookiePath === "/jwglxt" || String(cookiePath || "").startsWith("/jwglxt/");
}

function selectJwxtCookies(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const route = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "route" && c.path === "/");
  const jsession = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "JSESSIONID" && isJwglxtPath(c.path));
  const rememberMe = list.find(c => String(c.domain || "").includes("newjwc.tyust.edu.cn") && c.name === "rememberMe" && isJwglxtPath(c.path));
  return [route, jsession, rememberMe].filter(Boolean);
}

function cookieHeader(cookies) {
  const selected = selectJwxtCookies(cookies);
  return selected.map(c => c.name + "=" + c.value).join("; ");
}

function jwxtLoginErrorCode(err) {
  const message = String((err && err.message) || "").toLowerCase();
  if (message.includes("captcha") || message.includes("验证码") || message.includes("风控")) {
    return "JWXT_CAPTCHA_REQUIRED";
  }
  return "JWXT_LOGIN_FAILED";
}

async function ensureCookies(userId) {
  let cookies = loadCookies(userId);
  if (cookieHeader(cookies)) return cookies;

  const credentials = credentialStore.getJwxtCredentials(userId);
  if (!credentials) {
    const err = new Error("请先绑定教务账号");
    err.code = "LOGIN_REQUIRED";
    throw err;
  }

  let login;
  try {
    login = await httpJwxtLogin(credentials.studentId, credentials.password);
  } catch (cause) {
    const err = new Error(cause && cause.message ? cause.message : "教务系统登录失败");
    err.code = jwxtLoginErrorCode(cause);
    throw err;
  }

  cookies = selectJwxtCookies(login.cookies);
  if (!cookieHeader(cookies)) {
    const err = new Error("教务系统登录失败，未获取到有效 Cookie");
    err.code = "JWXT_LOGIN_FAILED";
    throw err;
  }
  writeCookies(cookies, userId);
  return cookies;
}

function pick(raw, names) {
  for (const name of names) {
    if (raw && raw[name] !== undefined && raw[name] !== null && raw[name] !== "") return raw[name];
  }
  return "";
}

function numberFrom(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function normalizeWeekday(raw) {
  const value = pick(raw, ["xqj", "XQJ", "weekday", "weekDay", "xqjmc", "XQJMC"]);
  const text = String(value || "");
  if (/^[1-7]$/.test(text)) return Number(text);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  for (const key of Object.keys(map)) {
    if (text.includes(key)) return map[key];
  }
  return 0;
}

function normalizeSection(raw) {
  const value = pick(raw, ["jc", "JC", "jcs", "JCS", "jcdm", "JCDM", "section"]);
  const text = String(value || "");
  const first = numberFrom(text);
  if (!first) return 0;
  if (first <= 2) return 1;
  if (first <= 4) return 2;
  if (first <= 6) return 3;
  return 4;
}

function parseWeekType(text) {
  const value = String(text || "");
  if (value.includes("单")) return "ODD";
  if (value.includes("双")) return "EVEN";
  return "ALL";
}

function parseWeekRanges(weeksRaw) {
  const text = String(weeksRaw || "");
  const ranges = [];

  String(text || "")
    .split(/[;,，；、]/)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const weekType = parseWeekType(part);
      const rangeRe = /(\d+)\s*-\s*(\d+)/g;
      let match;
      let used = part;

      while ((match = rangeRe.exec(part))) {
        ranges.push({ weekStart: Number(match[1]), weekEnd: Number(match[2]), weekType });
        used = used.replace(match[0], "");
      }

      const singles = used.match(/\d+/g) || [];
      singles.forEach(n => {
        const week = Number(n);
        if (week > 0) ranges.push({ weekStart: week, weekEnd: week, weekType });
      });
    });

  if (!ranges.length) ranges.push({ weekStart: 1, weekEnd: 20, weekType: parseWeekType(text) });
  return ranges;
}

function parseClassroom(classroomRaw) {
  const text = String(classroomRaw || "").trim();
  if (!text) return { building: "", room: "", displayLocation: "地点待定" };

  const dashed = text.match(/^(\d{1,2})\s*-\s*(\d{3,4})$/);
  if (dashed) {
    const buildingNo = String(Number(dashed[1]));
    const room = dashed[2];
    const building = buildingNo + "号楼";
    return {
      building,
      room,
      displayLocation: building + room + "教室"
    };
  }

  if (/^\d{5}$/.test(text)) {
    const buildingNo = String(Number(text.slice(0, 2)));
    const room = text.slice(2);
    const building = buildingNo + "号楼";
    return {
      building,
      room,
      displayLocation: building + room + "教室"
    };
  }

  if (/^\d{4}$/.test(text)) {
    const buildingNo = String(Number(text.slice(0, 1)));
    const room = text.slice(1);
    const building = buildingNo + "号楼";
    return {
      building,
      room,
      displayLocation: building + room + "教室"
    };
  }

  return { building: "", room: "", displayLocation: text };
}

function responseItems(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.kbList)) return data.kbList;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function normalizeTimetableItems(rawItems, term, userId) {
  const now = new Date().toISOString();
  const rows = [];

  rawItems.forEach((raw, rawIndex) => {
    const courseName = String(pick(raw, ["kcmc", "KCMC", "courseName", "name"]) || "").trim();
    const weekday = normalizeWeekday(raw);
    const section = normalizeSection(raw);
    if (!courseName || !weekday || !section) return;

    const classroomRaw = String(pick(raw, ["cdmc", "CDMC", "jxcdmc", "JXCDMC", "classroom", "room"]) || "").trim();
    const weeksRaw = String(pick(raw, ["zcd", "ZCD", "weeks", "qsjsz", "QSJSZ"]) || "").trim();
    const teacherName = String(pick(raw, ["xm", "XM", "jsxm", "JSXM", "teacherName"]) || "").trim();
    const classroom = parseClassroom(classroomRaw);
    const ranges = parseWeekRanges(weeksRaw);

    ranges.forEach((range, rangeIndex) => {
      rows.push({
        id: [userId || "legacy", term.termYear, term.termSemester, weekday, section, rawIndex, rangeIndex].join("_"),
        userId: userId || "legacy",
        termYear: String(term.termYear),
        termSemester: String(term.termSemester),
        weekday,
        section,
        courseName,
        teacherName,
        classroomRaw,
        building: classroom.building,
        room: classroom.room,
        displayLocation: classroom.displayLocation,
        weeksRaw,
        weekStart: range.weekStart,
        weekEnd: range.weekEnd,
        weekType: range.weekType,
        source: "JWXT",
        updatedAt: now,
        raw
      });
    });
  });

  return rows;
}

async function fetchTimetable(cookies, term) {
  const cs = cookieHeader(cookies);
  if (!cs) throw new Error("Missing JWXT session cookie");

  const headers = {
    "Cookie": cs,
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer": TIMETABLE_PAGE,
    "User-Agent": "Mozilla/5.0"
  };

  await axios.get(TIMETABLE_PAGE, {
    headers,
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15000
  });

  const body = new URLSearchParams({
    xnm: String(term.termYear),
    xqm: String(term.termSemester)
  }).toString();

  const resp = await axios.post(TIMETABLE_QUERY, body, {
    headers,
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 30000
  });

  if (resp.status !== 200) {
    const err = new Error("JWXT timetable returned HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }

  const items = responseItems(resp.data);
  if (!items.length && typeof resp.data === "string" && resp.data.includes("login")) {
    const err = new Error("JWXT cookie expired");
    err.code = "COOKIE_EXPIRED";
    throw err;
  }

  return items;
}

async function syncTimetableForUser(userId, storage, options) {
  const term = options && options.term ? options.term : loadConfiguredTerm();
  let cookies = await ensureCookies(userId);
  let rawItems;

  try {
    rawItems = await fetchTimetable(cookies, term);
  } catch (err) {
    if (err.code !== "COOKIE_EXPIRED") throw err;
    const credentials = credentialStore.getJwxtCredentials(userId);
    if (!credentials) throw err;
    let login;
    try {
      login = await httpJwxtLogin(credentials.studentId, credentials.password);
    } catch (cause) {
      const nextErr = new Error(cause && cause.message ? cause.message : "教务系统登录失败");
      nextErr.code = jwxtLoginErrorCode(cause);
      throw nextErr;
    }
    cookies = selectJwxtCookies(login.cookies);
    writeCookies(cookies, userId);
    rawItems = await fetchTimetable(cookies, term);
  }

  const rows = normalizeTimetableItems(rawItems, term, userId);
  if (rows.length === 0) {
    return {
      success: false,
      error: "TIMETABLE_EMPTY",
      message: "已登录教务系统，但没有解析到课表数据",
      termYear: String(term.termYear),
      termSemester: String(term.termSemester),
      rawCount: rawItems.length,
      syncedCount: 0,
      updatedAt: new Date().toISOString()
    };
  }

  storage.replaceTimetableForTerm(term.termYear, term.termSemester, rows);
  return {
    success: true,
    termYear: String(term.termYear),
    termSemester: String(term.termSemester),
    rawCount: rawItems.length,
    syncedCount: rows.length,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  syncTimetableForUser,
  normalizeTimetableItems,
  parseWeekRanges,
  parseClassroom
};
