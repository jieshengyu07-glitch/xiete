const assert = require("assert");
const os = require("os");
process.env.NODE_ENV = "development";
process.env.DATA_DIR = process.env.DATA_DIR || os.tmpdir();
const fixture = require("./fixtures/timetable-section5.json");
const { normalizeTimetableItems } = require("../src/timetable/sync");
const { SECTION_NUMBERS, publicClassTimeConfig } = require("../src/timetable/classPeriods");
const { coursesFromSections, resolveCourseTimeline } = require("../weapp/utils/timetableTimeline");
const reviewDemo = require("../src/services/reviewDemo");

function normalizedFor(jc) {
  return normalizeTimetableItems([
    Object.assign({}, fixture, { jc })
  ], { termYear: "2026", termSemester: "3" }, "anonymous-test-user")[0];
}

[
  ["1-2", 1],
  ["3-4", 2],
  ["5-6", 3],
  ["7-8", 4],
  ["9-10", 5]
].forEach(([jc, section]) => {
  assert.strictEqual(normalizedFor(jc).section, section, jc);
});
assert.strictEqual(normalizeTimetableItems([
  Object.assign({}, fixture, { jc: "11-12" })
], { termYear: "2026", termSemester: "3" }, "anonymous-test-user").length, 0);

const evening = normalizedFor("9-10");
const afternoon = normalizedFor("7-8");
const classPeriods = publicClassTimeConfig().classPeriods;
const timeline = resolveCourseTimeline({
  sections: [
    { section: 5, courses: [evening] },
    { section: 4, courses: [afternoon] }
  ],
  classPeriods,
  termStatus: "IN_TERM",
  now: "2026-09-09T18:30:00+08:00"
});

assert.deepStrictEqual(SECTION_NUMBERS, [1, 2, 3, 4, 5]);
assert.deepStrictEqual(timeline.courses.map(course => course.section), [4, 5]);
assert.strictEqual(timeline.courses[0].timeText, "16:30—18:10");
assert.strictEqual(timeline.courses[1].timeText, "第9-10节");
assert.strictEqual(timeline.courses[1].startTime, "");
assert.strictEqual(timeline.courses[1].endTime, "");
assert.strictEqual(timeline.courses[1].hasExactTime, false);
assert.strictEqual(timeline.courses[1].timelineRole, "unknown");
assert.strictEqual(timeline.state, "TIME_UNKNOWN");
assert.notStrictEqual(timeline.courses[1].timeText, "16:30—18:10");

const reviewToday = reviewDemo.getTodayTimetable("2026-09-09");
const reviewWeek = reviewDemo.getWeekTimetable("2026-09-09");
assert.deepStrictEqual(reviewToday.sections.map(item => item.section), SECTION_NUMBERS);
assert(reviewWeek.days.every(day => day.sections.map(item => item.section).join(",") === SECTION_NUMBERS.join(",")));

console.log("section5MappingRenderingSortingAndUnknownTimeSafetyTest=passed");
