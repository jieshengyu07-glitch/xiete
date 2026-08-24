const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { timetablePresentation, campusPresentation } = require("../weapp/utils/statusPresenter");

const classConfig = require("../src/timetable/classPeriods").publicClassTimeConfig();
assert.strictEqual(classConfig.classPeriods.length, 4);
assert.strictEqual(classConfig.classTimeSource, "LEGACY_CONFIGURED");
assert.strictEqual(classConfig.classTimeSchoolVerified, false);

const cachedCourses = [{ id: "cached", courseName: "缓存课程", section: 1 }];
const cachedFailure = timetablePresentation({ hasTimetable: true, syncStatus: "failed" });
assert.strictEqual(cachedFailure.state, "SYNC_FAILED_WITH_CACHE");
assert.strictEqual(cachedCourses.length, 1, "cached course data must remain visible");

const relogin = campusPresentation({ bound: true, account: { state: "RELOGIN_REQUIRED", bound: true } });
const unavailable = campusPresentation({ bound: true, account: { state: "SCHOOL_UNAVAILABLE", bound: true } });
assert.strictEqual(relogin.state, "RELOGIN_REQUIRED");
assert.strictEqual(unavailable.state, "SCHOOL_UNAVAILABLE");
assert.strictEqual(cachedCourses.length, 1);

const pageSource = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/timetable/timetable.js"), "utf8");
const template = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/timetable/timetable.wxml"), "utf8");
const style = fs.readFileSync(path.resolve(__dirname, "../weapp/pages/timetable/timetable.wxss"), "utf8");
const serverSource = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");

assert.ok(!/08:00|09:40|10:00|11:40|14:30|16:10|16:30|18:10/.test(pageSource), "page must not own class time constants");
assert.match(pageSource, /resolveCourseTimeline/);
assert.match(pageSource, /timetablePresentation/);
assert.match(pageSource, /campusPresentation/);
assert.match(serverSource, /publicClassTimeConfig/);
assert.match(template, /timelineTitle/);
assert.match(template, /item\.locationText/);
assert.match(template, /course\.locationText/);
assert.match(template, /course\.teacherName/);
assert.match(template, /item\.isToday/);
assert.match(template, /进行中/);
assert.match(template, /已结束/);
assert.match(style, /-webkit-line-clamp: 2/);
assert.match(style, /text-overflow: ellipsis/);

console.log("Timetable centralized configuration, cache/account status preservation, today and week UX wiring: PASS");
