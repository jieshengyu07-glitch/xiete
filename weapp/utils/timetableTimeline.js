const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SECTION_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);

function sectionLabel(section) {
  return Number(section) === 5 ? "第9-10节" : (section ? "第" + section + "大节" : "时间待定");
}

function minutesOf(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function shanghaiNow(value) {
  const instant = value ? new Date(value) : new Date();
  if (Number.isNaN(instant.getTime())) return null;
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MS);
  return {
    date: shifted.getUTCFullYear() + "-" +
      String(shifted.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(shifted.getUTCDate()).padStart(2, "0"),
    weekday: shifted.getUTCDay() || 7,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}

function periodMap(periods) {
  const result = {};
  (Array.isArray(periods) ? periods : []).forEach(item => {
    const section = Number(item && item.section);
    const startMinutes = minutesOf(item && item.startTime);
    const endMinutes = minutesOf(item && item.endTime);
    if (!section || startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return;
    result[section] = Object.assign({}, item, {
      section,
      startMinutes,
      endMinutes,
      timeText: item.startTime + "—" + item.endTime
    });
  });
  return result;
}

function locationOf(course) {
  return String(course && (course.displayLocation || course.classroomRaw || course.displayRoom || course.room) || "").trim() || "教室待定";
}

function normalizeCourse(course, sectionValue, periods) {
  const section = Number(course && course.section || sectionValue || 0);
  const period = periods[section];
  const name = String(course && course.courseName || "").trim() || "课程名称待定";
  return Object.assign({}, course || {}, {
    section,
    courseName: name,
    teacherName: String(course && course.teacherName || "").trim(),
    locationText: locationOf(course),
    startTime: period ? period.startTime : "",
    startLabel: period ? period.startTime : sectionLabel(section),
    endTime: period ? period.endTime : "",
    startMinutes: period ? period.startMinutes : null,
    endMinutes: period ? period.endMinutes : null,
    timeText: period ? period.timeText : sectionLabel(section),
    hasExactTime: Boolean(period)
  });
}

function coursesFromSections(sections, classPeriods) {
  const periods = periodMap(classPeriods);
  const courses = [];
  (Array.isArray(sections) ? sections : []).forEach(section => {
    (Array.isArray(section && section.courses) ? section.courses : []).forEach(course => {
      courses.push(normalizeCourse(course, section.section, periods));
    });
  });
  return courses.sort((a, b) => {
    const aTime = a.startMinutes === null ? Number.MAX_SAFE_INTEGER : a.startMinutes;
    const bTime = b.startMinutes === null ? Number.MAX_SAFE_INTEGER : b.startMinutes;
    return aTime - bTime || a.section - b.section || a.courseName.localeCompare(b.courseName);
  });
}

function inactiveTimeline(termStatus, courses) {
  const state = String(termStatus || "").toUpperCase();
  const titles = {
    PRE_TERM: "新学期尚未开始",
    VACATION: "当前处于假期",
    BETWEEN_TERMS: "当前处于学期间隔"
  };
  if (!titles[state]) return null;
  return {
    state,
    title: titles[state],
    description: state === "PRE_TERM" ? "课表将在新学期开始后显示。" : "当前不计算进行中或下一节课程。",
    currentCourse: null,
    nextCourse: null,
    courses,
    totalCourses: courses.length,
    remainingCourses: 0
  };
}

function resolveCourseTimeline(options) {
  const input = options || {};
  const courses = coursesFromSections(input.sections, input.classPeriods);
  const inactive = inactiveTimeline(input.termStatus, courses);
  if (inactive) return inactive;

  const now = shanghaiNow(input.now);
  if (!courses.length) {
    return {
      state: "NO_CLASS_TODAY",
      title: "今天没有课",
      description: "今天可以自行安排时间。",
      currentCourse: null,
      nextCourse: null,
      courses,
      totalCourses: 0,
      remainingCourses: 0
    };
  }

  const currentMinutes = now ? now.minutes : null;
  const currentCourse = currentMinutes === null ? null : courses.find(course =>
    course.startMinutes !== null && currentMinutes >= course.startMinutes && currentMinutes < course.endMinutes
  ) || null;
  const nextCourse = currentMinutes === null ? null : courses.find(course =>
    course.startMinutes !== null && course.startMinutes > currentMinutes
  ) || null;

  const decorated = courses.map(course => {
    let timelineRole = "unknown";
    if (currentMinutes !== null && course.hasExactTime) {
      if (currentMinutes >= course.endMinutes) timelineRole = "past";
      else if (currentMinutes >= course.startMinutes) timelineRole = "current";
      else timelineRole = "future";
    }
    return Object.assign({}, course, { timelineRole });
  });

  let state;
  let title;
  let description;
  if (currentCourse) {
    state = "IN_CLASS";
    title = "正在上课";
    const hasUnknownLaterCourse = courses.some(course => !course.hasExactTime && course.section > currentCourse.section);
    description = nextCourse ? "下一节：" + nextCourse.courseName + " · " + nextCourse.startTime :
      (hasUnknownLaterCourse ? "后续还有时间待确认的课程安排" : "这是今天最后一门课");
  } else if (nextCourse) {
    const firstTimed = courses.find(course => course.hasExactTime);
    state = firstTimed === nextCourse ? "BEFORE_FIRST_CLASS" : "BETWEEN_CLASSES";
    title = "下一节课";
    const diff = nextCourse.startMinutes - currentMinutes;
    description = diff > 0 ? "距上课还有 " + diff + " 分钟" : "";
  } else {
    const hasUnknownTimeCourse = courses.some(course => !course.hasExactTime);
    state = hasUnknownTimeCourse ? "TIME_UNKNOWN" : "AFTER_LAST_CLASS";
    title = hasUnknownTimeCourse ? "今天还有课程安排" : "今天的课上完了";
    description = hasUnknownTimeCourse ? "具体时间请以节次为准。" : "今天共 " + courses.length + " 门课";
  }

  const focusCourse = currentCourse || nextCourse;
  const focusIndex = focusCourse ? courses.indexOf(focusCourse) : -1;
  return {
    state,
    title,
    description,
    focusCourse: focusIndex >= 0 ? decorated[focusIndex] : null,
    currentCourse,
    nextCourse,
    courses: decorated,
    totalCourses: courses.length,
    remainingCourses: decorated.filter(course => course.timelineRole === "future").length
  };
}

module.exports = {
  SECTION_NUMBERS,
  minutesOf,
  shanghaiNow,
  periodMap,
  coursesFromSections,
  resolveCourseTimeline
};
