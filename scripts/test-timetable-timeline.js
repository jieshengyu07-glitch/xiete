const assert = require("assert");
const { resolveCourseTimeline, shanghaiNow } = require("../weapp/utils/timetableTimeline");

const classPeriods = [
  { section: 1, startTime: "08:00", endTime: "09:40" },
  { section: 2, startTime: "10:00", endTime: "11:40" },
  { section: 3, startTime: "14:30", endTime: "16:10" }
];
const sections = [
  { section: 3, courses: [{ id: "c", courseName: "一门非常非常长但仍然必须完整保留的数据结构与算法课程名称", classroomRaw: "实验中心超长名称教室", teacherName: "一位名字很长的教师" }] },
  { section: 1, courses: [{ id: "a", courseName: "高等数学", displayLocation: "A101" }] },
  { section: 2, courses: [{ id: "b", courseName: "大学英语" }] }
];

function resolveAt(localTime, source) {
  return resolveCourseTimeline({
    sections: source || sections,
    classPeriods,
    termStatus: "IN_TERM",
    now: "2026-10-12T" + localTime + ":00+08:00"
  });
}

const before = resolveAt("07:30");
assert.strictEqual(before.state, "BEFORE_FIRST_CLASS");
assert.strictEqual(before.nextCourse.courseName, "高等数学");

const inClass = resolveAt("08:30");
assert.strictEqual(inClass.state, "IN_CLASS");
assert.strictEqual(inClass.currentCourse.courseName, "高等数学");
assert.strictEqual(inClass.nextCourse.courseName, "大学英语");

const between = resolveAt("09:50");
assert.strictEqual(between.state, "BETWEEN_CLASSES");
assert.strictEqual(between.nextCourse.courseName, "大学英语");

const eleven = resolveAt("11:00");
assert.strictEqual(eleven.courses[0].timelineRole, "past");
assert.strictEqual(eleven.courses[1].timelineRole, "current");
assert.strictEqual(eleven.courses[2].timelineRole, "future");

const after = resolveAt("18:30");
assert.strictEqual(after.state, "AFTER_LAST_CLASS");
assert.strictEqual(after.nextCourse, null);

const empty = resolveAt("10:00", []);
assert.strictEqual(empty.state, "NO_CLASS_TODAY");

assert.deepStrictEqual(before.courses.map(item => item.id), ["a", "b", "c"], "courses must sort by configured start time");
assert.strictEqual(before.courses[1].locationText, "教室待定");
assert.strictEqual(before.courses[1].teacherName, "");
assert.ok(before.courses[2].courseName.length > 20);

const missingTime = resolveCourseTimeline({
  sections: [{ section: 9, courses: [{ id: "missing", courseName: "待定课程" }] }],
  classPeriods,
  termStatus: "IN_TERM",
  now: "2026-10-12T10:00:00+08:00"
});
assert.strictEqual(missingTime.courses[0].timeText, "第9大节");
assert.strictEqual(missingTime.courses[0].startTime, "");

["PRE_TERM", "VACATION", "BETWEEN_TERMS"].forEach(termStatus => {
  const result = resolveCourseTimeline({ sections, classPeriods, termStatus, now: "2026-08-13T10:00:00+08:00" });
  assert.strictEqual(result.state, termStatus);
  assert.strictEqual(result.currentCourse, null);
  assert.strictEqual(result.nextCourse, null);
});

assert.deepStrictEqual(shanghaiNow("2026-10-11T18:30:00Z"), {
  date: "2026-10-12",
  weekday: 1,
  minutes: 150
});

console.log("Timetable timeline states, Shanghai time, sorting, long/missing fields and term states: PASS");
