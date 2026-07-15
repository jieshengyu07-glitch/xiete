const assert = require("assert");
process.env.NODE_ENV = "development";
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir();
const { teachingWeekInfo } = require("../src/timetable/calendar");

const term = {
  termYear: "2025",
  termSemester: "12",
  semesterStartDate: "2026-02-24",
  teachingWeekStartDate: "2026-03-09",
  teachingWeekEndDate: "2026-07-12",
  maxTeachingWeeks: 18
};

const firstWeek = teachingWeekInfo(term, "2026-03-09");
assert.strictEqual(firstWeek.isTeachingPeriod, true);
assert.strictEqual(firstWeek.weekNumber, 1);
assert.strictEqual(firstWeek.weekType, "ODD");

const holiday = teachingWeekInfo(term, "2026-07-15");
assert.strictEqual(holiday.isTeachingPeriod, false);
assert.strictEqual(holiday.isHoliday, true);
assert.strictEqual(holiday.academicStatus, "HOLIDAY");
assert.strictEqual(holiday.weekType, "NONE");
console.log("teachingWeekAndHolidayBoundaryTest=passed");
