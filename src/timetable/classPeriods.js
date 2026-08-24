// These values centralize the timetable times that were previously embedded in
// the mini-program page. The repository contains no official school source for
// them, so clients must treat them as configured (not school-verified) times.
const CLASS_PERIODS = Object.freeze([
  Object.freeze({ section: 1, sectionStart: 1, sectionEnd: 2, startTime: "08:00", endTime: "09:40" }),
  Object.freeze({ section: 2, sectionStart: 3, sectionEnd: 4, startTime: "10:00", endTime: "11:40" }),
  Object.freeze({ section: 3, sectionStart: 5, sectionEnd: 6, startTime: "14:30", endTime: "16:10" }),
  Object.freeze({ section: 4, sectionStart: 7, sectionEnd: 8, startTime: "16:30", endTime: "18:10" })
]);

function publicClassTimeConfig() {
  return {
    classPeriods: CLASS_PERIODS.map(item => Object.assign({}, item)),
    classTimeSource: "LEGACY_CONFIGURED",
    classTimeSchoolVerified: false
  };
}

module.exports = { CLASS_PERIODS, publicClassTimeConfig };
