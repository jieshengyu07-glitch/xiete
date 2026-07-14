const assert = require("assert");
const { mergeGrades } = require("../src/grade/gradeMerger");
const { buildGradeKey, normalizeGrade } = require("../src/grade/gradeNormalizer");

function jwxtGrade(index, extra) {
  return {
    KCH: "K" + String(index).padStart(3, "0"),
    KCMC: "课程" + index,
    CJ: "80",
    XF: "2.00",
    XNM: "2025",
    XQM: "12",
    KCXZ: "必修",
    source: "jwxt",
    ...(extra || {})
  };
}

function testSameCourseSameTermDedupes() {
  const jwxt = {
    KCMC: "汽车理论与运用",
    CJ: "60",
    XF: "2.5",
    term: "2025-2026-2",
    source: "jwxt"
  };
  const xg = {
    courseName: "汽车理论与运用",
    score: "60.00",
    credit: "2.50",
    term: "2025-2026学年第2学期",
    source: "xg"
  };
  const result = mergeGrades([jwxt], [xg]).grades;
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].sources.sort(), ["jwxt", "xg"]);
  assert.strictEqual(result[0].score, "60.00");
}

function testSameCourseDifferentTermsStaySeparate() {
  const a = {
    courseName: "汽车理论与运用",
    score: "60",
    credit: "2.5",
    term: "2024-2025-2",
    source: "jwxt"
  };
  const b = {
    courseName: "汽车理论与运用",
    score: "60.00",
    credit: "2.50",
    term: "2025-2026-2",
    source: "xg"
  };
  const result = mergeGrades([a], [b]).grades;
  assert.strictEqual(result.length, 2);
}

function testExistingSixtyWithTwoXgDuplicatesStaysSixty() {
  const existing = Array.from({ length: 60 }, (_, index) => jwxtGrade(index + 1));
  const incoming = [
    {
      courseName: "课程1",
      score: "80.00",
      credit: "2",
      term: "2025-2026学年第2学期",
      source: "xg"
    },
    {
      courseName: "课程2",
      score: "80.00",
      credit: "2.00",
      term: "2025-2026-2",
      source: "xg"
    }
  ];
  const result = mergeGrades(existing, incoming).grades;
  assert.strictEqual(result.length, 60);
}

function testConflictPrefersJwxt() {
  const jwxt = {
    courseName: "汽车理论与运用",
    score: "85",
    credit: "2.5",
    term: "2025-2026-2",
    source: "jwxt"
  };
  const xg = {
    courseName: "汽车理论与运用",
    score: "82",
    credit: "2.50",
    term: "2025-2026学年第2学期",
    source: "xg"
  };
  const result = mergeGrades([jwxt], [xg]).grades;
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].score, "85.00");
  assert.strictEqual(result[0].preferredSource, "jwxt");
  assert.strictEqual(result[0].sourceScores.jwxt, "85.00");
  assert.strictEqual(result[0].sourceScores.xg, "82.00");
  assert.strictEqual(result[0].hasConflict, true);
}

function testXgAddsNewGradeWithoutDroppingOld() {
  const existing = Array.from({ length: 60 }, (_, index) => jwxtGrade(index + 1));
  const incoming = [{
    courseName: "新发现课程",
    score: "90",
    credit: "1.5",
    term: "2025-2026学年第2学期",
    source: "xg"
  }];
  const result = mergeGrades(existing, incoming).grades;
  assert.strictEqual(result.length, 61);
  assert(result.find(item => item.courseName === "新发现课程"));
}

function testKeyNormalization() {
  const a = normalizeGrade({
    courseName: "汽车理论与运用",
    score: "60",
    credit: "2.5",
    term: "2025-2026-2",
    source: "jwxt"
  });
  const b = normalizeGrade({
    courseName: " 汽车理论与运用 ",
    score: "60.00",
    credit: "2.50",
    term: "2025-2026学年第2学期",
    source: "xg"
  });
  assert.strictEqual(buildGradeKey(a), buildGradeKey(b));
}

testSameCourseSameTermDedupes();
testSameCourseDifferentTermsStaySeparate();
testExistingSixtyWithTwoXgDuplicatesStaysSixty();
testConflictPrefersJwxt();
testXgAddsNewGradeWithoutDroppingOld();
testKeyNormalization();

console.log("[test-grade-merger] ok");
