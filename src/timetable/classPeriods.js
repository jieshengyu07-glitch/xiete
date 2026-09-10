const CAMPUS_CODES = Object.freeze(["WANBAILIN", "JINYUAN"]);

// Safe fallback while the user has not selected a campus. Keep the existing
// section 1-4 behavior and leave section 5 without a fabricated time.
const CLASS_PERIODS = Object.freeze([
  Object.freeze({ section: 1, sectionStart: 1, sectionEnd: 2, startTime: "08:00", endTime: "09:40" }),
  Object.freeze({ section: 2, sectionStart: 3, sectionEnd: 4, startTime: "10:00", endTime: "11:40" }),
  Object.freeze({ section: 3, sectionStart: 5, sectionEnd: 6, startTime: "14:30", endTime: "16:10" }),
  Object.freeze({ section: 4, sectionStart: 7, sectionEnd: 8, startTime: "16:30", endTime: "18:10" }),
  Object.freeze({ section: 5, sectionStart: 9, sectionEnd: 10, startTime: "", endTime: "" })
]);

const SECTION_NUMBERS = Object.freeze(CLASS_PERIODS.map(item => item.section));

function freezePeriods(times) {
  return Object.freeze(times.map((time, index) => Object.freeze({
    section: index + 1,
    sectionStart: index * 2 + 1,
    sectionEnd: index * 2 + 2,
    startTime: time[0],
    endTime: time[1]
  })));
}

const SCHEDULES = Object.freeze({
  WANBAILIN_WINTER: freezePeriods([
    ["08:00", "09:40"], ["10:00", "11:40"], ["14:10", "15:50"],
    ["16:10", "17:50"], ["19:00", "20:40"]
  ]),
  WANBAILIN_SUMMER: freezePeriods([
    ["08:00", "09:40"], ["10:00", "11:40"], ["14:40", "16:20"],
    ["16:40", "18:20"], ["19:30", "21:10"]
  ]),
  JINYUAN_FIXED: freezePeriods([
    ["08:00", "09:40"], ["10:00", "11:40"], ["14:40", "16:20"],
    ["16:40", "18:20"], ["19:30", "21:10"]
  ])
});

function normalizeCampusCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return CAMPUS_CODES.includes(code) ? code : "";
}

function shanghaiMonthDay(value) {
  const text = String(value || "").trim();
  const plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return Number(plain[2]) * 100 + Number(plain[3]);
  const instant = value ? new Date(value) : new Date();
  if (Number.isNaN(instant.getTime())) return null;
  const shifted = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return (shifted.getUTCMonth() + 1) * 100 + shifted.getUTCDate();
}

function resolveClassPeriods(options) {
  const input = options || {};
  const campusCode = normalizeCampusCode(input.campusCode);
  let scheduleCode = "LEGACY_UNKNOWN_CAMPUS";
  let season = "UNKNOWN";
  let periods = CLASS_PERIODS;

  if (campusCode === "JINYUAN") {
    scheduleCode = "JINYUAN_FIXED";
    season = "FIXED";
    periods = SCHEDULES.JINYUAN_FIXED;
  } else if (campusCode === "WANBAILIN") {
    const monthDay = shanghaiMonthDay(input.date);
    const summer = monthDay !== null && monthDay >= 506 && monthDay < 1009;
    scheduleCode = summer ? "WANBAILIN_SUMMER" : "WANBAILIN_WINTER";
    season = summer ? "SUMMER" : "WINTER";
    periods = SCHEDULES[scheduleCode];
  }

  return {
    campusCode,
    campusName: campusCode === "WANBAILIN" ? "万柏林校区" : (campusCode === "JINYUAN" ? "晋源校区" : ""),
    campusSelectionRequired: !campusCode,
    scheduleCode,
    season,
    classPeriods: periods.map(item => Object.assign({}, item)),
    classTimeSource: campusCode ? "PRODUCT_CONFIG" : "LEGACY_CONFIGURED",
    classTimeSchoolVerified: false
  };
}

function publicClassTimeConfig(options) {
  return resolveClassPeriods(options);
}

module.exports = {
  CAMPUS_CODES,
  CLASS_PERIODS,
  SECTION_NUMBERS,
  SCHEDULES,
  normalizeCampusCode,
  resolveClassPeriods,
  publicClassTimeConfig
};
