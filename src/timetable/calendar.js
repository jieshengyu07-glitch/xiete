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
      teachingWeekStartDate: ""
    };
  }

  return {
    termYear: String(year - 1),
    termSemester: "12",
    semesterStartDate: process.env.SEMESTER_START_DATE || (year === 2026 ? "2026-02-24" : firstMonday(year, 1)),
    teachingWeekStartDate: process.env.TEACHING_WEEK_START_DATE || ""
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
    teachingWeekStartDate: String(process.env.TEACHING_WEEK_START_DATE || fileConfig.teachingWeekStartDate || fallback.teachingWeekStartDate || "")
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

function teachingWeekInfo(termConfig, date) {
  if (!termConfig || !parseDateOnly(termConfig.teachingWeekStartDate)) {
    const err = new Error("teachingWeekStartDate is required in data/term_config.json");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }

  const today = startOfChinaDay(date);
  const start = startOfChinaDay(termConfig.teachingWeekStartDate);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const weekNumber = Math.max(1, Math.floor(diffDays / 7) + 1);
  const weekday = today.getDay() === 0 ? 7 : today.getDay();
  const weekType = weekNumber % 2 === 1 ? "ODD" : "EVEN";
  return {
    termYear: String(termConfig.termYear),
    termSemester: String(termConfig.termSemester),
    semesterStartDate: termConfig.semesterStartDate,
    teachingWeekStartDate: termConfig.teachingWeekStartDate,
    weekNumber,
    currentTeachingWeek: weekNumber,
    weekType,
    weekTypeText: weekType === "ODD" ? "单周" : "双周",
    weekTypeName: weekType === "ODD" ? "单周" : "双周",
    weekday,
    date: dateOnly(today)
  };
}

function currentTermInfo(date) {
  return teachingWeekInfo(loadConfiguredTerm(), date);
}

module.exports = {
  loadConfiguredTerm,
  teachingWeekInfo,
  currentTermInfo
};
