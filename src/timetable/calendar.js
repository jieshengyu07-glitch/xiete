const fs = require("fs");
const path = require("path");
const config = require("../config");

const CONFIG_FILE = path.join(config.dataDir, "term_config.json");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateOnly(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function firstMonday(year, monthIndex) {
  const date = new Date(year, monthIndex, 1);
  while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
  return dateOnly(date);
}

function defaultTermConfig(today) {
  const d = today || new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  if (month >= 8) {
    return {
      termYear: String(year),
      termSemester: "3",
      semesterStartDate: firstMonday(year, 8),
      teachingWeekStartDate: "",
      teachingWeekEndDate: "",
      maxTeachingWeeks: 18
    };
  }

  return {
    termYear: String(year - 1),
    termSemester: "12",
    semesterStartDate: process.env.SEMESTER_START_DATE || (year === 2026 ? "2026-02-24" : firstMonday(year, 1)),
    teachingWeekStartDate: process.env.TEACHING_WEEK_START_DATE || "",
    teachingWeekEndDate: process.env.TEACHING_WEEK_END_DATE || "",
    maxTeachingWeeks: 18
  };
}

function loadConfiguredTerm() {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
    }
  } catch (err) {
    console.error("[timetable] failed to read term_config.json:", err.message);
  }

  const fallback = defaultTermConfig();
  return {
    termYear: String(process.env.TIMETABLE_TERM_YEAR || fileConfig.termYear || fallback.termYear),
    termSemester: String(process.env.TIMETABLE_TERM_SEMESTER || fileConfig.termSemester || fallback.termSemester),
    semesterStartDate: String(process.env.SEMESTER_START_DATE || fileConfig.semesterStartDate || fallback.semesterStartDate || ""),
    teachingWeekStartDate: String(process.env.TEACHING_WEEK_START_DATE || fileConfig.teachingWeekStartDate || fallback.teachingWeekStartDate || ""),
    teachingWeekEndDate: String(process.env.TEACHING_WEEK_END_DATE || fileConfig.teachingWeekEndDate || fallback.teachingWeekEndDate || ""),
    maxTeachingWeeks: Math.max(1, Number(process.env.MAX_TEACHING_WEEKS || fileConfig.maxTeachingWeeks || fallback.maxTeachingWeeks || 18))
  };
}

function parseDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfChinaDay(value) {
  const parsed = typeof value === "string" ? parseDateOnly(value) : null;
  if (parsed) return parsed;

  const d = value ? new Date(value) : new Date();
  const china = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return new Date(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate());
}

function assertTermConfig(termConfig) {
  const term = termConfig || loadConfiguredTerm();
  const start = parseDateOnly(term.teachingWeekStartDate);
  const end = term.teachingWeekEndDate ? parseDateOnly(term.teachingWeekEndDate) : null;
  if (!start) {
    const err = new Error("TEACHING_WEEK_START_DATE must be configured as YYYY-MM-DD");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (!Number.isFinite(Number(term.maxTeachingWeeks)) || Number(term.maxTeachingWeeks) < 1) {
    const err = new Error("MAX_TEACHING_WEEKS must be a positive integer");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (term.teachingWeekEndDate && !end) {
    const err = new Error("TEACHING_WEEK_END_DATE must be configured as YYYY-MM-DD");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (end && end.getTime() < start.getTime()) {
    const err = new Error("TEACHING_WEEK_END_DATE must not be earlier than TEACHING_WEEK_START_DATE");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  return term;
}

function teachingWeekInfo(termConfig, date) {
  const term = assertTermConfig(termConfig);

  const today = startOfChinaDay(date);
  const start = startOfChinaDay(term.teachingWeekStartDate);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const rawWeekNumber = Math.floor(diffDays / 7) + 1;
  const maxTeachingWeeks = Number(term.maxTeachingWeeks || 18);
  const calculatedEnd = new Date(start.getTime() + maxTeachingWeeks * 7 * 86400000 - 86400000);
  const configuredEnd = term.teachingWeekEndDate ? startOfChinaDay(term.teachingWeekEndDate) : null;
  const teachingEnd = configuredEnd || calculatedEnd;
  const isTeachingPeriod = diffDays >= 0 && today.getTime() <= teachingEnd.getTime() && rawWeekNumber <= maxTeachingWeeks;
  const weekNumber = isTeachingPeriod
    ? rawWeekNumber
    : (diffDays < 0 ? 1 : maxTeachingWeeks);
  const weekday = today.getDay() === 0 ? 7 : today.getDay();
  const weekType = isTeachingPeriod ? (weekNumber % 2 === 1 ? "ODD" : "EVEN") : "NONE";
  const academicStatus = isTeachingPeriod ? "TEACHING" : (diffDays < 0 ? "BEFORE_TERM" : "HOLIDAY");
  return {
    termYear: String(term.termYear),
    termSemester: String(term.termSemester),
    semesterStartDate: term.semesterStartDate,
    teachingWeekStartDate: term.teachingWeekStartDate,
    teachingWeekEndDate: dateOnly(teachingEnd),
    maxTeachingWeeks,
    weekNumber,
    currentTeachingWeek: weekNumber,
    weekType,
    weekTypeText: weekType === "ODD" ? "单周" : (weekType === "EVEN" ? "双周" : "非教学周"),
    weekTypeName: weekType === "ODD" ? "单周" : (weekType === "EVEN" ? "双周" : "非教学周"),
    isTeachingPeriod,
    isHoliday: academicStatus === "HOLIDAY",
    academicStatus,
    academicStatusText: academicStatus === "TEACHING" ? "教学周" : (academicStatus === "BEFORE_TERM" ? "学期未开始" : "假期"),
    weekday,
    date: dateOnly(today)
  };
}

function currentTermInfo(date) {
  return teachingWeekInfo(loadConfiguredTerm(), date);
}

module.exports = {
  loadConfiguredTerm,
  assertTermConfig,
  teachingWeekInfo,
  currentTermInfo
};
