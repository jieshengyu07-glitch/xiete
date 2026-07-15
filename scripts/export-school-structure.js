const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { safeUserId } = require("../src/services/userPaths");
const config = require("../src/config");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = config.dataDir;
const OUTPUT_FILE = path.join(DATA_DIR, "school.json");

const JWXT_BASE = "https://newjwc.tyust.edu.cn/jwglxt";
const XG_BASE = "https://xg.tyust.edu.cn";

const SEARCH_TERMS = [
  "college",
  "major",
  "zy",
  "dept",
  "academy",
  "speciality",
  "org",
  "department"
];

const COLLEGE_KEYS = [
  "college",
  "collegename",
  "academy",
  "academyname",
  "department",
  "departmentname",
  "dept",
  "deptname",
  "org",
  "orgname",
  "xy",
  "xymc",
  "xyname",
  "dwmc",
  "jgmc",
  "yxmc",
  "院系",
  "学院",
  "部门"
];

const MAJOR_KEYS = [
  "major",
  "majorname",
  "speciality",
  "specialityname",
  "specialty",
  "specialtyname",
  "profession",
  "professionname",
  "zy",
  "zymc",
  "zyname",
  "专业"
];

const CHILD_KEYS = [
  "majors",
  "majorlist",
  "specialities",
  "specialitylist",
  "specialties",
  "zylist",
  "zyxxlist",
  "children",
  "nodes",
  "list"
];

const STATIC_SCHOOL = {
  "机械工程学院": [
    "机械设计制造及其自动化",
    "机械电子工程",
    "机器人工程",
    "智能制造工程"
  ],
  "材料科学与工程学院": [
    "材料成型及控制工程",
    "材料科学与工程",
    "焊接技术与工程",
    "功能材料"
  ],
  "电子信息工程学院": [
    "自动化",
    "电子信息工程",
    "通信工程",
    "测控技术与仪器"
  ],
  "计算机科学与技术学院": [
    "计算机科学与技术",
    "软件工程",
    "物联网工程",
    "数据科学与大数据技术"
  ],
  "车辆与交通工程学院": [
    "车辆工程",
    "交通运输",
    "交通工程",
    "新能源汽车工程"
  ],
  "经济与管理学院": [
    "工商管理",
    "会计学",
    "市场营销",
    "工业工程",
    "经济学"
  ],
  "应用科学学院": [
    "公共基础课",
    "数学与应用数学",
    "信息与计算科学",
    "工程力学"
  ],
  "法学院": [
    "法学",
    "社会工作"
  ],
  "外国语学院": [
    "英语",
    "日语"
  ],
  "艺术学院": [
    "视觉传达设计",
    "环境设计",
    "产品设计"
  ],
  "马克思主义学院": [
    "思想政治理论课"
  ],
  "体育学院": [
    "体育公共课"
  ]
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function userIdFromArgs() {
  return safeUserId(argValue("--user") || process.env.OPENID || process.env.USER_ID || "");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function userPaths(userId) {
  if (!userId) {
    return {
      cookiesPath: path.join(DATA_DIR, "cookies.json"),
      campusPath: path.join(DATA_DIR, "campus.json")
    };
  }
  const userDir = path.join(DATA_DIR, "users", userId);
  return {
    cookiesPath: path.join(userDir, "cookies.json"),
    campusPath: path.join(userDir, "campus.json")
  };
}

function domainMatches(host, domain) {
  const clean = String(domain || "").replace(/^\./, "").toLowerCase();
  return host === clean || host.endsWith("." + clean);
}

function pathMatches(requestPath, cookiePath) {
  const base = String(cookiePath || "/");
  return requestPath === base || requestPath.startsWith(base.endsWith("/") ? base : base + "/");
}

function cookieHeaderFor(cookies, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return "";
  }
  const host = parsed.hostname.toLowerCase();
  const requestPath = parsed.pathname || "/";
  return (Array.isArray(cookies) ? cookies : [])
    .filter(cookie => cookie && cookie.name && cookie.value)
    .filter(cookie => domainMatches(host, cookie.domain) && pathMatches(requestPath, cookie.path || "/"))
    .map(cookie => cookie.name + "=" + cookie.value)
    .join("; ");
}

function safeUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname + parsed.pathname.replace(/\/\(S\([^/]+\)\)\//g, "/(S(**redacted**))/");
  } catch (err) {
    return "unknown";
  }
}

function cleanText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\u3000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(key) {
  return String(key || "").replace(/[_\-\s]/g, "").toLowerCase();
}

function isCollegeName(value) {
  const text = cleanText(value);
  return text.length >= 2 &&
    text.length <= 40 &&
    /学院|院系|系|教学部|基础部|中心|书院/.test(text) &&
    !/密码|账号|电话|身份证|token|cookie|session/i.test(text);
}

function isMajorName(value) {
  const text = cleanText(value);
  return text.length >= 2 &&
    text.length <= 50 &&
    !/https?:\/\//i.test(text) &&
    !/密码|账号|电话|身份证|token|cookie|session/i.test(text) &&
    !/^[-\d\s.]+$/.test(text);
}

function fieldValue(obj, keys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const wanted = new Set(keys);
  for (const key of Object.keys(obj)) {
    const normalized = normalizeKey(key);
    if (wanted.has(normalized) || wanted.has(key)) {
      const value = obj[key];
      if (typeof value === "string" || typeof value === "number") return cleanText(value);
    }
  }
  return "";
}

function nameValue(obj) {
  return fieldValue(obj, ["name", "mc", "text", "label", "title", "value"]);
}

class SchoolCollector {
  constructor() {
    this.map = new Map();
    this.sources = new Set();
  }

  add(college, major, source) {
    const c = cleanText(college);
    const m = cleanText(major);
    if (!isCollegeName(c) || !isMajorName(m)) return;
    if (!this.map.has(c)) this.map.set(c, new Set());
    this.map.get(c).add(m);
    if (source) this.sources.add(source);
  }

  toObject() {
    const result = {};
    Array.from(this.map.keys()).sort((a, b) => a.localeCompare(b, "zh-CN")).forEach(college => {
      result[college] = Array.from(this.map.get(college)).sort((a, b) => a.localeCompare(b, "zh-CN"));
    });
    return result;
  }

  stats() {
    const obj = this.toObject();
    return {
      colleges: Object.keys(obj).length,
      majors: Object.values(obj).reduce((sum, list) => sum + list.length, 0),
      sources: this.sources.size
    };
  }
}

function scanSchoolValue(value, collector, source, parentCollege) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(item => scanSchoolValue(item, collector, source, parentCollege));
    return;
  }

  const college = fieldValue(value, COLLEGE_KEYS) || (isCollegeName(nameValue(value)) ? nameValue(value) : "");
  const major = fieldValue(value, MAJOR_KEYS);
  if (college && major) collector.add(college, major, source);
  if (parentCollege && major) collector.add(parentCollege, major, source);

  const currentCollege = college || parentCollege;
  Object.keys(value).forEach(key => {
    const child = value[key];
    const normalized = normalizeKey(key);
    if (currentCollege && CHILD_KEYS.includes(normalized) && Array.isArray(child)) {
      child.forEach(item => {
        if (typeof item === "string") collector.add(currentCollege, item, source);
        else {
          const childMajor = fieldValue(item, MAJOR_KEYS) || nameValue(item);
          if (childMajor) collector.add(currentCollege, childMajor, source);
          scanSchoolValue(item, collector, source, currentCollege);
        }
      });
      return;
    }
    scanSchoolValue(child, collector, source, currentCollege);
  });
}

function parseJsonMaybe(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text || !/^[\[{]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function scanResponseBody(body, collector, source) {
  const json = parseJsonMaybe(body);
  if (json) {
    scanSchoolValue(json, collector, source, "");
    return;
  }

  const html = String(body || "");
  const $ = cheerio.load(html);
  $("tr").each((_, row) => {
    const cells = $(row).find("td,th").map((__, cell) => cleanText($(cell).text())).get().filter(Boolean);
    cells.forEach(college => {
      if (!isCollegeName(college)) return;
      cells.forEach(major => {
        if (major !== college && isMajorName(major) && !isCollegeName(major)) collector.add(college, major, source);
      });
    });
  });
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(String(value || ""), baseUrl).toString();
  } catch (err) {
    return "";
  }
}

function hasSearchTerm(value) {
  const lower = String(value || "").toLowerCase();
  return SEARCH_TERMS.some(term => lower.includes(term)) || /学院|专业|院系|组织|部门/.test(String(value || ""));
}

function isUnsafeUrl(url) {
  const lower = safeUrl(url).toLowerCase();
  return /\/(save|update|delete|remove|logout|login|choose|bind|unbind|submit|edit)\b/.test(lower);
}

function isReasonableCandidateUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const raw = parsed.pathname + parsed.search;
    if (raw.length > 220) return false;
    if (/%20|\s|\+/.test(raw)) return false;
    if (/[{}()[\],;]/.test(raw)) return false;
    return true;
  } catch (err) {
    return false;
  }
}

function isAllowedSystemPath(url) {
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (host === "newjwc.tyust.edu.cn") return pathname.startsWith("/jwglxt/");
    if (host === "xg.tyust.edu.cn") return pathname.startsWith("/userhall/") || pathname.startsWith("/apps/");
    return true;
  } catch (err) {
    return false;
  }
}

function extractCandidates(text, baseUrl, sameHost) {
  const raw = String(text || "").replace(/\\\//g, "/");
  const values = new Set();
  const quoted = /["']([^"']{2,300})["']/g;
  let match;
  while ((match = quoted.exec(raw))) values.add(match[1]);
  const paths = /\/[A-Za-z0-9_./-]+(?:\.(?:html|json|js|aspx))?(?:\?[^"' <>)\]]*)?/g;
  while ((match = paths.exec(raw))) values.add(match[0]);

  return Array.from(values)
    .filter(hasSearchTerm)
    .map(value => absoluteUrl(value, baseUrl))
    .filter(Boolean)
    .filter(url => {
      try {
        const parsed = new URL(url);
        return !sameHost || parsed.hostname === sameHost;
      } catch (err) {
        return false;
      }
    })
    .filter(isReasonableCandidateUrl)
    .filter(isAllowedSystemPath)
    .filter(url => !isUnsafeUrl(url));
}

function extractScriptUrls(html, baseUrl, sameHost) {
  const $ = cheerio.load(String(html || ""));
  return $("script[src]").map((_, node) => absoluteUrl($(node).attr("src"), baseUrl)).get()
    .filter(Boolean)
    .filter(url => {
      try {
        return !sameHost || new URL(url).hostname === sameHost;
      } catch (err) {
        return false;
      }
    });
}

async function fetchText(url, headers) {
  const response = await axios.get(url, {
    headers,
    timeout: 12000,
    maxRedirects: 3,
    validateStatus: status => status >= 200 && status < 500
  });
  return {
    status: response.status,
    data: response.data,
    contentType: String((response.headers && response.headers["content-type"]) || "")
  };
}

async function probeUrls(label, urls, headers, collector, counters) {
  const seen = new Set();
  for (const url of urls) {
    if (!url || seen.has(url) || isUnsafeUrl(url)) continue;
    seen.add(url);
    try {
      const response = await fetchText(url, headers);
      counters[label] = (counters[label] || 0) + 1;
      console.log("[school-export] probe=" + label + " status=" + response.status + " target=" + safeUrl(url));
      if (response.status >= 200 && response.status < 300) {
        scanResponseBody(response.data, collector, label + ":" + safeUrl(url));
      }
    } catch (err) {
      console.log("[school-export] probe=" + label + " status=failed target=" + safeUrl(url) + " code=" + String(err.code || "ERROR"));
    }
  }
}

async function probeJwxt(cookies, collector, counters) {
  const entryUrls = [
    JWXT_BASE + "/xtgl/index_initMenu.html",
    JWXT_BASE + "/xtgl/index_cxYhxxIndex.html?xt=jwglxt&localeKey=zh_CN",
    JWXT_BASE + "/xsxxxggl/xsgrxxwh_cxXsgrxxIndex.html?gnmkdm=N100801&layout=default",
    JWXT_BASE + "/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801&layout=default"
  ];
  const directUrls = [
    JWXT_BASE + "/xtgl/comm_cxXydmList.html",
    JWXT_BASE + "/xtgl/comm_cxZydmList.html",
    JWXT_BASE + "/xtgl/comm_cxXyZyList.html",
    JWXT_BASE + "/xtgl/comm_cxBmdmList.html",
    JWXT_BASE + "/xtgl/comm_cxXydm.html",
    JWXT_BASE + "/xtgl/comm_cxZydm.html"
  ];

  const firstCookieHeader = cookieHeaderFor(cookies, JWXT_BASE + "/");
  if (!firstCookieHeader) {
    console.log("[school-export] jwxt=skipped reason=no-session-cookie");
    return;
  }

  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/html, */*",
    "Cookie": firstCookieHeader
  };
  const candidates = new Set(directUrls);

  for (const url of entryUrls) {
    try {
      const response = await fetchText(url, headers);
      counters.jwxtEntry = (counters.jwxtEntry || 0) + 1;
      console.log("[school-export] probe=jwxt-entry status=" + response.status + " target=" + safeUrl(url));
      if (response.status >= 200 && response.status < 300) {
        scanResponseBody(response.data, collector, "jwxt-entry:" + safeUrl(url));
        extractCandidates(response.data, url, "newjwc.tyust.edu.cn").forEach(item => candidates.add(item));
        const scripts = extractScriptUrls(response.data, url, "newjwc.tyust.edu.cn").slice(0, 30);
        for (const scriptUrl of scripts) {
          try {
            const script = await fetchText(scriptUrl, headers);
            counters.jwxtScript = (counters.jwxtScript || 0) + 1;
            extractCandidates(script.data, scriptUrl, "newjwc.tyust.edu.cn").forEach(item => candidates.add(item));
          } catch (err) {}
        }
      }
    } catch (err) {
      console.log("[school-export] probe=jwxt-entry status=failed target=" + safeUrl(url) + " code=" + String(err.code || "ERROR"));
    }
  }

  await probeUrls("jwxt-candidate", Array.from(candidates).slice(0, 80), headers, collector, counters);
}

function readXgSession(campus) {
  if (campus && campus.xgSession && campus.xgSession.scoreUrl && campus.xgSession.cookies) {
    return campus.xgSession;
  }
  return null;
}

async function probeXg(session, collector, counters) {
  if (!session || !session.scoreUrl || !session.cookies) {
    console.log("[school-export] xg=skipped reason=no-session");
    return;
  }
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/html, */*",
    "Cookie": String(session.cookies),
    "Referer": String(session.scoreUrl)
  };
  const directUrls = [
    XG_BASE + "/userhall/api/home/service/type",
    XG_BASE + "/userhall/api/home/service/get/all",
    XG_BASE + "/userhall/api/user/getCurrentUserInfo",
    XG_BASE + "/userhall/api/org/tree",
    XG_BASE + "/userhall/api/organization/tree",
    XG_BASE + "/userhall/api/department/tree"
  ];
  const candidates = new Set(directUrls);

  try {
    const response = await fetchText(session.scoreUrl, headers);
    counters.xgEntry = (counters.xgEntry || 0) + 1;
    console.log("[school-export] probe=xg-entry status=" + response.status + " target=" + safeUrl(session.scoreUrl));
    if (response.status >= 200 && response.status < 300) {
      scanResponseBody(response.data, collector, "xg-entry:" + safeUrl(session.scoreUrl));
      extractCandidates(response.data, session.scoreUrl, "xg.tyust.edu.cn").forEach(item => candidates.add(item));
      const scripts = extractScriptUrls(response.data, session.scoreUrl, "xg.tyust.edu.cn").slice(0, 30);
      for (const scriptUrl of scripts) {
        try {
          const script = await fetchText(scriptUrl, headers);
          counters.xgScript = (counters.xgScript || 0) + 1;
          extractCandidates(script.data, scriptUrl, "xg.tyust.edu.cn").forEach(item => candidates.add(item));
        } catch (err) {}
      }
    }
  } catch (err) {
    console.log("[school-export] probe=xg-entry status=failed target=" + safeUrl(session.scoreUrl) + " code=" + String(err.code || "ERROR"));
  }

  await probeUrls("xg-candidate", Array.from(candidates).slice(0, 80), headers, collector, counters);
}

function sortedSchoolMap(map) {
  const result = {};
  Object.keys(map).sort((a, b) => a.localeCompare(b, "zh-CN")).forEach(college => {
    result[college] = Array.from(new Set(map[college] || []))
      .map(cleanText)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  });
  return result;
}

function shouldUseDiscovered(stats) {
  return stats.colleges >= 5 && stats.majors >= 20 && stats.sources >= 1;
}

async function main() {
  const userId = userIdFromArgs();
  const paths = userPaths(userId);
  const cookies = readJson(paths.cookiesPath, []);
  const campus = readJson(paths.campusPath, {});
  const xgSession = readXgSession(campus);
  const collector = new SchoolCollector();
  const counters = {};

  console.log("[school-export] mode=readonly userScope=" + (userId ? "user" : "legacy"));
  console.log("[school-export] jwxtCookiePresent=" + Boolean(cookieHeaderFor(cookies, JWXT_BASE + "/")));
  console.log("[school-export] xgSessionPresent=" + Boolean(xgSession && xgSession.scoreUrl && xgSession.cookies));

  await probeJwxt(cookies, collector, counters);
  await probeXg(xgSession, collector, counters);

  const discovered = collector.toObject();
  const discoveredStats = collector.stats();
  const outputSource = shouldUseDiscovered(discoveredStats) ? "system-interface" : "static-fallback";
  const output = outputSource === "system-interface" ? discovered : STATIC_SCHOOL;
  const finalMap = sortedSchoolMap(output);
  const finalStats = {
    colleges: Object.keys(finalMap).length,
    majors: Object.values(finalMap).reduce((sum, list) => sum + list.length, 0)
  };

  if (outputSource === "static-fallback") {
    console.log("[school-export] completeInterfaceFound=false");
    console.log("[school-export] reason=No complete college-major catalogue was confirmed from JWXT/XG probes; current-user/profile-like data is not enough for a full dictionary.");
  } else {
    console.log("[school-export] completeInterfaceFound=true");
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalMap, null, 2), "utf8");

  console.log("[school-export] discoveredCollegeCount=" + discoveredStats.colleges);
  console.log("[school-export] discoveredMajorCount=" + discoveredStats.majors);
  console.log("[school-export] outputSource=" + outputSource);
  console.log("[school-export] outputCollegeCount=" + finalStats.colleges);
  console.log("[school-export] outputMajorCount=" + finalStats.majors);
  console.log("[school-export] output=data/school.json");
}

main().catch(err => {
  console.error("[school-export] failed code=" + String(err && (err.code || err.name) || "ERROR"));
  process.exitCode = 1;
});
