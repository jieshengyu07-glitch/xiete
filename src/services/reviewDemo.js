const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getUserPaths, safeUserId } = require("./userPaths");
const { assertUserDataWritable } = require("./userDataDeletion");

const DEMO_VERSION = 1;
const MIN_PASSWORD_LENGTH = 16;
const EXAMPLE_VALUES = new Set([
  "review_demo",
  "review-demo",
  "demo_account",
  "demo-password",
  "change-me",
  "changeme",
  "password",
  "123456"
]);

const DEMO_GRADES = Object.freeze([
  { id: "demo-grade-1", courseName: "高等数学（示例）", score: "88", credit: "4.0", courseType: "必修", xnm: "2025", xqm: "12", term: "2025-2026学年第2学期", source: "review_demo" },
  { id: "demo-grade-2", courseName: "大学英语（示例）", score: "优秀", credit: "2.0", courseType: "必修", xnm: "2025", xqm: "12", term: "2025-2026学年第2学期", source: "review_demo" },
  { id: "demo-grade-3", courseName: "程序设计基础（示例）", score: "92", credit: "3.0", courseType: "必修", xnm: "2025", xqm: "12", term: "2025-2026学年第2学期", source: "review_demo" },
  { id: "demo-grade-4", courseName: "大学体育（示例）", score: "良好", credit: "1.0", courseType: "必修", xnm: "2025", xqm: "12", term: "2025-2026学年第2学期", source: "review_demo" },
  { id: "demo-grade-5", courseName: "线性代数（示例）", score: "85", credit: "2.5", courseType: "必修", xnm: "2025", xqm: "3", term: "2025-2026学年第1学期", source: "review_demo" },
  { id: "demo-grade-6", courseName: "计算机基础（示例）", score: "90", credit: "2.0", courseType: "必修", xnm: "2025", xqm: "3", term: "2025-2026学年第1学期", source: "review_demo" }
]);

function isEnabled() {
  return String(process.env.REVIEW_DEMO_ENABLED || "").trim().toLowerCase() === "true";
}

function configuredUsername() {
  return String(process.env.REVIEW_DEMO_USERNAME || "").trim();
}

function configuredPassword() {
  return String(process.env.REVIEW_DEMO_PASSWORD || "");
}

function invalidExample(value) {
  return EXAMPLE_VALUES.has(String(value || "").trim().toLowerCase());
}

function assertReviewDemoConfig() {
  if (!isEnabled()) return true;
  const username = configuredUsername();
  const password = configuredPassword();
  if (!username || !password || password.length < MIN_PASSWORD_LENGTH || invalidExample(username) || invalidExample(password) || username === password) {
    const err = new Error("REVIEW_DEMO_CONFIG_INVALID");
    err.code = "REVIEW_DEMO_CONFIG_INVALID";
    throw err;
  }
  return true;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  const length = Math.max(a.length, b.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  a.copy(paddedA);
  b.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

function isReservedUsername(username) {
  return /^(review|audit|demo)[_-]/i.test(String(username || "").trim());
}

function classifyCredentials(username, password) {
  const normalizedUsername = String(username || "").trim();
  const reserved = isReservedUsername(normalizedUsername);
  if (!isEnabled()) return reserved ? "unavailable" : "none";
  assertReviewDemoConfig();
  if (!constantTimeEqual(normalizedUsername, configuredUsername())) return reserved ? "invalid" : "none";
  return constantTimeEqual(password, configuredPassword()) ? "match" : "invalid";
}

function markerPath(userId) {
  const safe = safeUserId(userId);
  return safe ? getUserPaths(safe).reviewDemoPath : "";
}

function readMarker(userId) {
  const file = markerPath(userId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && value.mode === "review_demo" && Number(value.version) === DEMO_VERSION ? value : null;
  } catch (err) {
    return null;
  }
}

function isReviewDemoUser(userId) {
  return Boolean(isEnabled() && readMarker(userId));
}

function activate(userId) {
  const safe = safeUserId(userId);
  if (!safe) {
    const err = new Error("INVALID_USER_SCOPE");
    err.code = "INVALID_USER_SCOPE";
    throw err;
  }
  assertReviewDemoConfig();
  assertUserDataWritable(safe);
  const file = markerPath(safe);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const marker = {
    mode: "review_demo",
    version: DEMO_VERSION,
    activatedAt: new Date().toISOString()
  };
  const temporary = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(temporary, JSON.stringify(marker, null, 2), "utf8");
  fs.renameSync(temporary, file);
  return marker;
}

function deactivate(userId) {
  const file = markerPath(userId);
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
}

function cloneGrades() {
  return DEMO_GRADES.map(item => Object.assign({}, item));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function demoDateInfo(dateValue) {
  let date;
  if (dateValue) {
    const match = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }
  if (!date || Number.isNaN(date.getTime())) {
    const china = new Date(Date.now() + 8 * 60 * 60 * 1000);
    date = new Date(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate());
  }
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  return {
    termYear: "2025",
    termSemester: "12",
    semesterStartDate: "2026-02-24",
    teachingWeekStartDate: "2026-03-09",
    teachingWeekEndDate: "2026-07-12",
    maxTeachingWeeks: 18,
    weekNumber: 8,
    currentTeachingWeek: 8,
    weekType: "EVEN",
    weekTypeText: "双周",
    weekTypeName: "双周",
    isTeachingPeriod: true,
    isHoliday: false,
    academicStatus: "TEACHING",
    academicStatusText: "审核演示课表",
    weekday,
    date: date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate())
  };
}

const DAY_COURSES = [
  ["高等数学（示例）", 1, "综合楼A101", "示例教师"],
  ["大学英语（示例）", 2, "教学楼B203", "示例教师"],
  ["程序设计基础（示例）", 3, "实验楼C305", "示例教师"],
  ["工程制图（示例）", 1, "教学楼B105", "示例教师"],
  ["大学体育（示例）", 4, "体育场", "示例教师"],
  ["创新实践（示例）", 2, "创新中心201", "示例教师"],
  ["职业规划（示例）", 3, "综合楼A205", "示例教师"]
];

function demoCourse(weekday) {
  const source = DAY_COURSES[Math.max(1, Math.min(7, Number(weekday))) - 1];
  return {
    id: "review-demo-course-" + weekday,
    weekday: Number(weekday),
    section: source[1],
    courseName: source[0],
    teacherName: source[3],
    classroomRaw: source[2],
    building: "",
    room: "",
    displayLocation: source[2],
    displayRoom: source[2],
    weeksRaw: "1-18周",
    weekStart: 1,
    weekEnd: 18,
    weekType: "ALL",
    source: "review_demo"
  };
}

function demoSections(weekday) {
  const course = demoCourse(weekday);
  return [1, 2, 3, 4].map(section => ({
    section,
    title: "第" + section + "大节",
    courses: section === course.section ? [course] : []
  }));
}

function timetableConfig(dateValue) {
  const info = demoDateInfo(dateValue);
  return Object.assign({
    success: true,
    reviewDemo: true,
    hasTimetable: true,
    timetableCount: 7
  }, info);
}

function todayTimetable(dateValue) {
  const info = demoDateInfo(dateValue);
  const sections = demoSections(info.weekday);
  const timetable = sections.flatMap(section => section.courses);
  return Object.assign({
    success: true,
    reviewDemo: true,
    fromCache: true,
    warning: false,
    warningCode: null,
    hasTimetable: true,
    syncing: false,
    syncStatus: "success",
    message: "审核演示数据",
    lastSuccessfulSyncAt: readMarkerTime(),
    lastFailedSyncAt: null,
    timetable,
    sections
  }, info);
}

function weekTimetable(dateValue) {
  const info = demoDateInfo(dateValue);
  return Object.assign({
    success: true,
    reviewDemo: true,
    fromCache: true,
    warning: false,
    warningCode: null,
    hasTimetable: true,
    syncing: false,
    syncStatus: "success",
    message: "审核演示数据",
    lastSuccessfulSyncAt: readMarkerTime(),
    lastFailedSyncAt: null,
    days: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, sections: demoSections(weekday) }))
  }, info);
}

function readMarkerTime() {
  return new Date().toISOString();
}

function status(userId) {
  const marker = readMarker(userId) || {};
  const activatedAt = marker.activatedAt || new Date().toISOString();
  return {
    status: "running",
    reviewDemo: true,
    bound: true,
    campusLoginStatus: "valid",
    gradeQueryStatus: "ready",
    timetableSyncStatus: "success",
    sessionRecoveryPending: false,
    portalAuthStatus: "OK",
    jwxtStatus: "DEMO",
    cookieValid: false,
    cookieStatus: "demo",
    xgScoreConfigured: false,
    xgSessionStatus: "missing",
    xgCookieValid: null,
    gradeSource: "review_demo",
    totalGrades: DEMO_GRADES.length,
    hasTimetable: true,
    unevaluatedCount: 0,
    unevaluatedCourses: [],
    lastCheckAt: activatedAt,
    lastSuccessfulSyncAt: activatedAt,
    lastFailedSyncAt: null,
    lastJwxtError: null,
    lastJwxtErrorMessage: null,
    version: "1.0.0"
  };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  assertReviewDemoConfig,
  classifyCredentials,
  isReservedUsername,
  isReviewDemoUser,
  activate,
  deactivate,
  getGrades: cloneGrades,
  getStatus: status,
  getTimetableConfig: timetableConfig,
  getTodayTimetable: todayTimetable,
  getWeekTimetable: weekTimetable
};
