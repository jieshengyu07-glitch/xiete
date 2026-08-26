const assert = require("assert");
process.env.NODE_ENV = "development";
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir();

const {
  teachingWeekInfo,
  inferAutoTermConfig,
  loadConfiguredTerm
} = require("../src/timetable/calendar");

const fixedTerm = {
  academicYear: 2025,
  semester: 2,
  xnm: "2025",
  xqm: "12",
  termYear: "2025",
  termSemester: "12",
  semesterStartDate: "2026-02-24",
  teachingWeekStartDate: "2026-03-09",
  teachingWeekEndDate: "2026-07-12",
  maxTeachingWeeks: 18,
  source: "MANUAL",
  termConfigSource: "MANUAL"
};

const before = teachingWeekInfo(fixedTerm, "2026-03-08");
assert.strictEqual(before.termStatus, "PRE_TERM");
assert.strictEqual(before.currentWeek, null);

const firstDay = teachingWeekInfo(fixedTerm, "2026-03-09");
assert.strictEqual(firstDay.termStatus, "IN_TERM");
assert.strictEqual(firstDay.currentWeek, 1);

const firstSunday = teachingWeekInfo(fixedTerm, "2026-03-15");
assert.strictEqual(firstSunday.currentWeek, 1);
assert.strictEqual(firstSunday.weekday, 7);

const secondMonday = teachingWeekInfo(fixedTerm, "2026-03-16");
assert.strictEqual(secondMonday.currentWeek, 2);
assert.strictEqual(secondMonday.weekType, "EVEN");

const lastWeek = teachingWeekInfo(fixedTerm, "2026-07-12");
assert.strictEqual(lastWeek.termStatus, "IN_TERM");
assert.strictEqual(lastWeek.currentWeek, 18);

const after = teachingWeekInfo(fixedTerm, "2026-07-13");
assert.strictEqual(after.termStatus, "VACATION");
assert.strictEqual(after.currentWeek, null);
assert.strictEqual(after.weekNumber, null);
console.log("dynamicTeachingWeekBoundaryTest=passed");

const august = teachingWeekInfo(inferAutoTermConfig("2026-08-13"), "2026-08-13");
assert.strictEqual(august.academicYear, 2026);
assert.strictEqual(august.semester, 1);
assert.strictEqual(august.xnm, "2026");
assert.strictEqual(august.xqm, "3");
assert.strictEqual(august.termStatus, "PRE_TERM");
assert.strictEqual(august.currentWeek, null);
assert.notStrictEqual(august.termYear, "2025");
console.log("august2026OldTermRegressionTest=passed");

const september = teachingWeekInfo(inferAutoTermConfig("2026-09-10"), "2026-09-10");
assert.strictEqual(september.academicYear, 2026);
assert.strictEqual(september.semester, 1);
assert.strictEqual(september.termStatus, "IN_TERM");

const january = teachingWeekInfo(inferAutoTermConfig("2027-01-10"), "2027-01-10");
assert.strictEqual(january.academicYear, 2026);
assert.strictEqual(january.semester, 1);

const march = teachingWeekInfo(inferAutoTermConfig("2027-03-10"), "2027-03-10");
assert.strictEqual(march.academicYear, 2026);
assert.strictEqual(march.semester, 2);
assert.strictEqual(march.termStatus, "IN_TERM");
console.log("crossCalendarYearAcademicYearTest=passed");

const shanghaiInstant = new Date("2026-08-31T16:30:00.000Z");
const shanghaiMidnight = teachingWeekInfo(
  inferAutoTermConfig(shanghaiInstant),
  shanghaiInstant
);
assert.strictEqual(shanghaiMidnight.date, "2026-09-01");
assert.strictEqual(shanghaiMidnight.academicYear, 2026);
console.log("asiaShanghaiBusinessDateTest=passed");

const original = {
  mode: process.env.TERM_CONFIG_MODE,
  year: process.env.TIMETABLE_TERM_YEAR,
  semester: process.env.TIMETABLE_TERM_SEMESTER,
  start: process.env.TEACHING_WEEK_START_DATE,
  end: process.env.TEACHING_WEEK_END_DATE
};

process.env.TERM_CONFIG_MODE = "auto";
process.env.TIMETABLE_TERM_YEAR = "2025";
process.env.TIMETABLE_TERM_SEMESTER = "12";
process.env.TEACHING_WEEK_START_DATE = "2026-03-09";
process.env.TEACHING_WEEK_END_DATE = "2026-07-12";
const automatic = loadConfiguredTerm("2026-08-13");
assert.strictEqual(automatic.termYear, "2026");
assert.strictEqual(automatic.termSemester, "3");
assert.strictEqual(automatic.termConfigSource, "OFFICIAL_SCHOOL_NOTICE");
assert.strictEqual(automatic.teachingWeekStartDate, "2026-08-31");
assert.strictEqual(automatic.teachingWeekStartSchoolVerified, true);
assert.strictEqual(automatic.teachingWeekEndSchoolVerified, false);

process.env.TERM_CONFIG_MODE = "manual";
const manual = loadConfiguredTerm("2026-08-13");
assert.strictEqual(manual.termYear, "2025");
assert.strictEqual(manual.termSemester, "12");
assert.strictEqual(manual.termConfigSource, "MANUAL");
console.log("explicitManualOverrideTest=passed");

Object.keys(original).forEach(key => {
  const envName = {
    mode: "TERM_CONFIG_MODE",
    year: "TIMETABLE_TERM_YEAR",
    semester: "TIMETABLE_TERM_SEMESTER",
    start: "TEACHING_WEEK_START_DATE",
    end: "TEACHING_WEEK_END_DATE"
  }[key];
  if (original[key] === undefined) delete process.env[envName];
  else process.env[envName] = original[key];
});
