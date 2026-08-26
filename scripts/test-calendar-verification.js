const assert = require("assert");
process.env.NODE_ENV = "development";
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir();
process.env.TERM_CONFIG_MODE = "auto";

const {
  inferAutoTermConfig,
  loadConfiguredTerm,
  teachingWeekInfo
} = require("../src/timetable/calendar");
const { publicClassTimeConfig } = require("../src/timetable/classPeriods");

const verifiedTerm = loadConfiguredTerm("2026-08-31");
assert.strictEqual(verifiedTerm.academicYear, 2026);
assert.strictEqual(verifiedTerm.semester, 1);
assert.strictEqual(verifiedTerm.teachingWeekStartDate, "2026-08-31");
assert.strictEqual(verifiedTerm.termConfigSource, "OFFICIAL_SCHOOL_NOTICE");
assert.strictEqual(verifiedTerm.teachingWeekStartSchoolVerified, true);
assert.strictEqual(verifiedTerm.teachingWeekEndSchoolVerified, false);
assert.strictEqual(verifiedTerm.schoolVerified, false);

for (const date of ["2026-08-28", "2026-08-29", "2026-08-30"]) {
  const info = teachingWeekInfo(verifiedTerm, date);
  assert.strictEqual(info.termStatus, "PRE_TERM", date);
  assert.strictEqual(info.currentWeek, null, date);
}

const firstMonday = teachingWeekInfo(verifiedTerm, "2026-08-31");
assert.strictEqual(firstMonday.termStatus, "IN_TERM");
assert.strictEqual(firstMonday.currentWeek, 1);

const firstSunday = teachingWeekInfo(verifiedTerm, "2026-09-06");
assert.strictEqual(firstSunday.termStatus, "IN_TERM");
assert.strictEqual(firstSunday.currentWeek, 1);

const secondMonday = teachingWeekInfo(verifiedTerm, "2026-09-07");
assert.strictEqual(secondMonday.termStatus, "IN_TERM");
assert.strictEqual(secondMonday.currentWeek, 2);
console.log("official2026FirstTeachingWeekBoundaryTest=passed");

const historical = loadConfiguredTerm("2025-09-08");
assert.strictEqual(historical.academicYear, 2025);
assert.strictEqual(historical.semester, 1);
assert.strictEqual(historical.termConfigSource, "AUTO");
assert.strictEqual(historical.teachingWeekStartSchoolVerified, false);

const future = loadConfiguredTerm("2027-09-08");
assert.strictEqual(future.academicYear, 2027);
assert.strictEqual(future.semester, 1);
assert.strictEqual(future.termConfigSource, "AUTO");
assert.strictEqual(future.teachingWeekStartSchoolVerified, false);

const secondSemester = inferAutoTermConfig("2027-03-08");
assert.strictEqual(secondSemester.academicYear, 2026);
assert.strictEqual(secondSemester.semester, 2);
assert.strictEqual(secondSemester.termConfigSource, "AUTO");
assert.strictEqual(secondSemester.teachingWeekStartSchoolVerified, false);
console.log("historicalFutureAndSecondSemesterInferenceRegressionTest=passed");

const classTime = publicClassTimeConfig();
assert.strictEqual(classTime.classTimeSource, "LEGACY_CONFIGURED");
assert.strictEqual(classTime.classTimeSchoolVerified, false);
assert.deepStrictEqual(classTime.classPeriods, [
  { section: 1, sectionStart: 1, sectionEnd: 2, startTime: "08:00", endTime: "09:40" },
  { section: 2, sectionStart: 3, sectionEnd: 4, startTime: "10:00", endTime: "11:40" },
  { section: 3, sectionStart: 5, sectionEnd: 6, startTime: "14:30", endTime: "16:10" },
  { section: 4, sectionStart: 7, sectionEnd: 8, startTime: "16:30", endTime: "18:10" }
]);
console.log("unverifiedLegacyClassTimeGuardTest=passed");
