const fs = require("fs");
const path = require("path");
const config = require("../config");

const CONFIG_FILE = path.join(config.dataDir, "term_config.json");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TEACHING_WEEKS = 18;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateParts(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  const instant = value ? new Date(value) : new Date();
  if (Number.isNaN(instant.getTime())) return null;
  const shanghai = new Date(instant.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shanghai.getUTCFullYear(),
    month: shanghai.getUTCMonth() + 1,
    day: shanghai.getUTCDate()
  };
}

function dateOnly(value) {
  const parts = value && value.year ? value : parseDateParts(value);
  if (!parts) return "";
  return parts.year + "-" + pad2(parts.month) + "-" + pad2(parts.day);
}

function dayNumber(value) {
  const parts = value && value.year ? value : parseDateParts(value);
  if (!parts) return NaN;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function dateFromDayNumber(value) {
  const date = new Date(Number(value) * DAY_MS);
  return dateOnly({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

function firstMonday(year, month) {
  let current = dayNumber({ year, month, day: 1 });
  while (new Date(current * DAY_MS).getUTCDay() !== 1) current += 1;
  return dateFromDayNumber(current);
}

function semesterToXqm(semester) {
  const value = Number(semester);
  if (value === 1) return "3";
  if (value === 2) return "12";
  return "";
}

function xqmToSemester(xqm) {
  const value = String(xqm || "");
  if (value === "3" || value === "1") return 1;
  if (value === "12" || value === "2") return 2;
  return null;
}

function createTerm(academicYear, semester, extra) {
  const year = Number(academicYear);
  const semesterNumber = Number(semester);
  const xqm = semesterToXqm(semesterNumber);
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || !xqm) {
    const err = new Error("Invalid academic term");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  return Object.assign({
    academicYear: year,
    semester: semesterNumber,
    xnm: String(year),
    xqm,
    termYear: String(year),
    termSemester: xqm
  }, extra || {});
}

function calculatedTeachingEnd(startDate, maxTeachingWeeks) {
  return dateFromDayNumber(dayNumber(startDate) + Number(maxTeachingWeeks) * 7 - 1);
}

function inferAutoTermConfig(date) {
  const today = parseDateParts(date);
  if (!today) {
    const err = new Error("Invalid date for term inference");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }

  let academicYear;
  let semester;
  let teachingYear;
  let teachingMonth;

  if (today.month >= 8) {
    academicYear = today.year;
    semester = 1;
    teachingYear = today.year;
    teachingMonth = 9;
  } else if (today.month === 1) {
    academicYear = today.year - 1;
    semester = 1;
    teachingYear = today.year - 1;
    teachingMonth = 9;
  } else {
    academicYear = today.year - 1;
    semester = 2;
    teachingYear = today.year;
    teachingMonth = 3;
  }

  const teachingWeekStartDate = firstMonday(teachingYear, teachingMonth);
  const maxTeachingWeeks = DEFAULT_MAX_TEACHING_WEEKS;
  return createTerm(academicYear, semester, {
    semesterStartDate: teachingYear + "-" + pad2(teachingMonth) + "-01",
    teachingWeekStartDate,
    teachingWeekEndDate: calculatedTeachingEnd(teachingWeekStartDate, maxTeachingWeeks),
    maxTeachingWeeks,
    source: "AUTO",
    termConfigSource: "AUTO"
  });
}

function readTermConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
    }
  } catch (err) {
    console.error("[term] failed to read term_config.json: " + err.message);
  }
  return {};
}

function normalizeConfiguredTerm(value, source) {
  const input = value || {};
  const academicYear = Number(input.academicYear || input.termYear || input.xnm);
  const semester = Number(input.semester || xqmToSemester(input.termSemester || input.xqm));
  const maxTeachingWeeks = Math.max(1, Number(input.maxTeachingWeeks || DEFAULT_MAX_TEACHING_WEEKS));
  return createTerm(academicYear, semester, {
    semesterStartDate: String(input.semesterStartDate || ""),
    teachingWeekStartDate: String(input.teachingWeekStartDate || ""),
    teachingWeekEndDate: String(input.teachingWeekEndDate || ""),
    maxTeachingWeeks,
    source,
    termConfigSource: source
  });
}

function manualTermConfig(fileConfig) {
  return normalizeConfiguredTerm({
    academicYear: process.env.TIMETABLE_TERM_YEAR || fileConfig.academicYear || fileConfig.termYear,
    semester: process.env.TIMETABLE_TERM_SEMESTER
      ? xqmToSemester(process.env.TIMETABLE_TERM_SEMESTER)
      : (fileConfig.semester || xqmToSemester(fileConfig.termSemester)),
    semesterStartDate: process.env.SEMESTER_START_DATE || fileConfig.semesterStartDate,
    teachingWeekStartDate: process.env.TEACHING_WEEK_START_DATE || fileConfig.teachingWeekStartDate,
    teachingWeekEndDate: process.env.TEACHING_WEEK_END_DATE || fileConfig.teachingWeekEndDate,
    maxTeachingWeeks: process.env.MAX_TEACHING_WEEKS || fileConfig.maxTeachingWeeks
  }, "MANUAL");
}

function matchingFallback(fileConfig, automatic) {
  const fileYear = String(fileConfig.academicYear || fileConfig.termYear || fileConfig.xnm || "");
  const fileSemester = String(fileConfig.termSemester || fileConfig.xqm || semesterToXqm(fileConfig.semester));
  if (fileYear !== automatic.xnm || fileSemester !== automatic.xqm) return null;
  if (!fileConfig.teachingWeekStartDate) return null;
  return normalizeConfiguredTerm(fileConfig, "FALLBACK");
}

function loadConfiguredTerm(date) {
  const fileConfig = readTermConfigFile();
  const mode = String(process.env.TERM_CONFIG_MODE || fileConfig.mode || "auto").trim().toLowerCase();
  if (mode === "manual") return manualTermConfig(fileConfig);

  const automatic = inferAutoTermConfig(date);
  return matchingFallback(fileConfig, automatic) || automatic;
}

function assertTermConfig(termConfig) {
  const term = termConfig || loadConfiguredTerm();
  if (!parseDateParts(term.teachingWeekStartDate)) {
    const err = new Error("TEACHING_WEEK_START_DATE must be configured as YYYY-MM-DD");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (!Number.isFinite(Number(term.maxTeachingWeeks)) || Number(term.maxTeachingWeeks) < 1) {
    const err = new Error("MAX_TEACHING_WEEKS must be a positive integer");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (term.teachingWeekEndDate && !parseDateParts(term.teachingWeekEndDate)) {
    const err = new Error("TEACHING_WEEK_END_DATE must be configured as YYYY-MM-DD");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  if (term.teachingWeekEndDate && dayNumber(term.teachingWeekEndDate) < dayNumber(term.teachingWeekStartDate)) {
    const err = new Error("TEACHING_WEEK_END_DATE must not be earlier than TEACHING_WEEK_START_DATE");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }
  return term;
}

function teachingWeekInfo(termConfig, date) {
  const term = assertTermConfig(termConfig);
  const todayParts = parseDateParts(date);
  if (!todayParts) {
    const err = new Error("Invalid business date");
    err.code = "TERM_CONFIG_INVALID";
    throw err;
  }

  const today = dayNumber(todayParts);
  const start = dayNumber(term.teachingWeekStartDate);
  const maxTeachingWeeks = Number(term.maxTeachingWeeks || DEFAULT_MAX_TEACHING_WEEKS);
  const calculatedEnd = start + maxTeachingWeeks * 7 - 1;
  const configuredEnd = term.teachingWeekEndDate ? dayNumber(term.teachingWeekEndDate) : calculatedEnd;
  const teachingEnd = Math.min(configuredEnd, calculatedEnd);
  const diffDays = today - start;
  const rawWeekNumber = Math.floor(diffDays / 7) + 1;
  const isTeachingPeriod = diffDays >= 0 && today <= teachingEnd && rawWeekNumber <= maxTeachingWeeks;
  const currentWeek = isTeachingPeriod ? rawWeekNumber : null;
  const termStatus = isTeachingPeriod
    ? "IN_TERM"
    : (today < start ? "PRE_TERM" : (Number(term.semester || xqmToSemester(term.termSemester)) === 1 ? "BETWEEN_TERMS" : "VACATION"));
  const weekType = isTeachingPeriod ? (currentWeek % 2 === 1 ? "ODD" : "EVEN") : "NONE";
  const academicStatus = termStatus === "IN_TERM" ? "TEACHING" : (termStatus === "PRE_TERM" ? "BEFORE_TERM" : "HOLIDAY");
  const statusText = {
    IN_TERM: "教学周",
    PRE_TERM: "新学期尚未开始",
    BETWEEN_TERMS: "学期间假期",
    VACATION: "假期",
    UNKNOWN: "学期状态待确认"
  }[termStatus] || "学期状态待确认";
  const weekday = new Date(today * DAY_MS).getUTCDay() || 7;

  return Object.assign({}, term, {
    academicYear: Number(term.academicYear || term.termYear),
    semester: Number(term.semester || xqmToSemester(term.termSemester)),
    xnm: String(term.xnm || term.termYear),
    xqm: String(term.xqm || term.termSemester),
    termYear: String(term.termYear || term.xnm),
    termSemester: String(term.termSemester || term.xqm),
    teachingWeekEndDate: dateFromDayNumber(teachingEnd),
    maxTeachingWeeks,
    termStatus,
    status: termStatus,
    weekNumber: currentWeek,
    currentWeek,
    currentTeachingWeek: currentWeek,
    weekType,
    weekTypeText: weekType === "ODD" ? "单周" : (weekType === "EVEN" ? "双周" : "非教学周"),
    weekTypeName: weekType === "ODD" ? "单周" : (weekType === "EVEN" ? "双周" : "非教学周"),
    isTeachingPeriod,
    isHoliday: termStatus === "VACATION" || termStatus === "BETWEEN_TERMS",
    academicStatus,
    academicStatusText: statusText,
    weekday,
    date: dateOnly(todayParts)
  });
}

function currentTermInfo(date) {
  const term = loadConfiguredTerm(date);
  const info = teachingWeekInfo(term, date);
  console.log("[term] academicYear=" + info.academicYear +
    " semester=" + info.semester +
    " status=" + info.termStatus +
    " source=" + info.termConfigSource);
  return info;
}

function generateGradeQueryTerms(academicYear, options) {
  const current = Number(academicYear);
  const cachedGrades = options && Array.isArray(options.cachedGrades) ? options.cachedGrades : [];
  const defaultYears = Math.max(1, Math.min(6, Number(options && options.defaultAcademicYears) || 4));
  const maximumYears = Math.max(defaultYears, Math.min(6, Number(options && options.maximumAcademicYears) || 6));
  let earliest = current - defaultYears + 1;

  const cachedYears = cachedGrades.map(item => Number(item && (item.xnm || item.XNM)))
    .filter(year => Number.isInteger(year) && year <= current && year >= current - maximumYears + 1);
  if (cachedYears.length) earliest = Math.min(earliest, Math.min(...cachedYears));
  earliest = Math.max(earliest, current - maximumYears + 1);

  const terms = [];
  for (let year = earliest; year <= current; year += 1) {
    terms.push(createTerm(year, 1));
    terms.push(createTerm(year, 2));
  }
  return terms;
}

module.exports = {
  loadConfiguredTerm,
  assertTermConfig,
  teachingWeekInfo,
  currentTermInfo,
  inferAutoTermConfig,
  createTerm,
  semesterToXqm,
  xqmToSemester,
  generateGradeQueryTerms,
  parseDateParts
};
