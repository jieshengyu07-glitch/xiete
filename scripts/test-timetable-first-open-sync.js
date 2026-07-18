const assert = require("assert");

async function testFrontendPolling() {
  const originalGetApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  const api = require("../weapp/utils/api");
  const originalRequest = api.request;
  const originalPage = global.Page;
  let definition;
  const responses = [
    { timetable: [], sections: [], hasTimetable: false, syncing: true, syncStatus: "running" },
    { sections: [{ section: 1, courses: [{ courseName: "Test Course" }] }], hasTimetable: true, syncing: false, syncStatus: "success" }
  ];
  api.request = async () => responses.shift();
  global.Page = value => { definition = value; };
  const pagePath = require.resolve("../weapp/pages/timetable/timetable");
  delete require.cache[pagePath];
  require(pagePath);
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    _timetablePageActive: true,
    setData(patch) { Object.assign(this.data, patch); }
  });
  let polls = 0;
  page.scheduleSyncPolling = () => { polls += 1; };
  try {
    await page.loadToday();
    assert.strictEqual(page.data.syncing, true);
    assert.strictEqual(page.data.notice, "正在同步课表...");
    assert.strictEqual(page.data.error, "");
    assert.strictEqual(polls, 1);
    await page.loadToday({ polling: true });
    assert.strictEqual(page.data.syncing, false);
    assert.strictEqual(page.data.hasTimetable, true);
    assert.strictEqual(page.data.hasTodayCourses, true);
    console.log("timetableFirstOpenAutomaticRefreshTest=passed");

    page.applyWeek({
      days: [{
        weekday: 1,
        sections: [
          { section: 1, courses: [{ id: "course-1", courseName: "第一节课程" }] },
          { section: 2, courses: [{ id: "course-2", courseName: "第二节课程" }] }
        ]
      }],
      hasTimetable: true,
      syncing: false,
      currentTeachingWeek: 1,
      weekType: "ODD"
    });
    assert.strictEqual(page.data.weekDays.length, 1);
    assert.strictEqual(page.data.weekDays[0].sections.length, 4);
    assert.strictEqual(page.data.weekDays[0].sections[0].courses[0].courseName, "第一节课程");
    assert.strictEqual(page.data.weekDays[0].sections[1].courses[0].courseName, "第二节课程");
    assert.strictEqual(page.data.weekDays[0].sections[2].courses.length, 0);
    assert.strictEqual(page.data.weekDays[0].sections[3].courses.length, 0);
    const weekTemplate = require("fs").readFileSync(require.resolve("../weapp/pages/timetable/timetable.wxml"), "utf8");
    assert.strictEqual(weekTemplate.includes("item.courseSections"), false);
    assert.strictEqual(weekTemplate.includes("section.courses.length === 0"), true);
    console.log("weeklyViewKeepsFourLessonSlotsTest=passed");
  } finally {
    api.request = originalRequest;
    global.Page = originalPage;
    global.getApp = originalGetApp;
  }
}

testFrontendPolling().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
