const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-library-"));
process.env.DATA_DIR = tempDir;

const storePath = path.join(__dirname, "..", "src", "rating", "courseRatingStore.js");
delete require.cache[require.resolve(storePath)];
const store = require(storePath);

function addCourse(name, collegeId, college, majorId, major) {
  return store.addCourse({
    name,
    courseName: name,
    collegeId,
    college,
    majorId,
    major,
    type: "考试",
    courseType: "考试",
    term: "大一上",
    semester: "大一上"
  }, "test_user");
}

try {
  const first = addCourse(
    "高等数学",
    "college_math",
    "数学学院",
    "major_math",
    "数学与应用数学"
  );
  assert.strictEqual(first.duplicated, false);
  assert.ok(first.course.courseId);
  assert.strictEqual(first.course.courseName, "高等数学");
  assert.strictEqual(first.course.collegeId, "college_math");
  assert.strictEqual(first.course.majorId, "major_math");
  console.log("courseCreateTest=passed");

  const duplicate = addCourse(
    "高等数学",
    "college_math",
    "数学学院",
    "major_math",
    "数学与应用数学"
  );
  assert.strictEqual(duplicate.duplicated, true);
  assert.strictEqual(duplicate.course.courseId, first.course.courseId);
  console.log("exactDuplicateTest=passed");

  const aliasDuplicate = addCourse(
    "高数",
    "college_math",
    "数学学院",
    "major_math",
    "数学与应用数学"
  );
  assert.strictEqual(aliasDuplicate.duplicated, true);
  assert.strictEqual(aliasDuplicate.course.courseId, first.course.courseId);
  console.log("aliasDuplicateTest=passed");

  const otherCollege = addCourse(
    "高等数学",
    "college_transport",
    "交通运输学院",
    "major_transport",
    "交通运输"
  );
  assert.strictEqual(otherCollege.duplicated, false);
  assert.notStrictEqual(otherCollege.course.courseId, first.course.courseId);
  console.log("sameNameDifferentCollegeTest=passed");

  const reviewOne = store.upsertReview(first.course.courseId, "review_user_a", {
    score: 8,
    difficulty: 7,
    grading: 8,
    workload: 6,
    recommend: 9,
    tags: "基础课,需要刷题",
    content: "这门课需要提前复习，平时练习很重要。"
  });
  assert.strictEqual(reviewOne.review.courseId, first.course.courseId);
  assert.strictEqual(store.listReviews(first.course.courseId, "hot", "review_user_a").length, 1);
  console.log("reviewCourseIdBindingTest=passed");

  store.upsertReview(first.course.courseId, "review_user_b", {
    score: 6,
    difficulty: 8,
    grading: 6,
    workload: 8,
    recommend: 6,
    tags: ["考试难", "计算多"],
    content: "同一门课的第二条评价应该聚合到同一个 courseId。"
  });

  const detail = store.getCourse(first.course.courseId, "review_user_a");
  assert.strictEqual(detail.course.reviewCount, 2);
  assert.strictEqual(detail.reviews.length, 2);

  const hotItems = store.hotCourseReviews(20).filter(item => item.courseId === first.course.courseId);
  assert.strictEqual(hotItems.length, 1);
  assert.strictEqual(hotItems[0].reviewCount, 2);
  assert.strictEqual(hotItems[0].score, 7);
  console.log("hotCourseIdAggregationTest=passed");

  const search = store.searchCourses("高数", 20).filter(item => item.courseId === first.course.courseId);
  assert.strictEqual(search.length, 1);
  console.log("courseSearchAliasTest=passed");

  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-library-legacy-"));
  const legacyRatingDir = path.join(legacyDir, "rating");
  fs.mkdirSync(legacyRatingDir, { recursive: true });
  process.env.DATA_DIR = legacyDir;
  fs.writeFileSync(path.join(legacyRatingDir, "courses.json"), JSON.stringify([
    {
      id: "legacy_linear_algebra",
      name: "线性代数",
      collegeId: "college_math",
      college: "数学学院",
      majorId: "major_math",
      major: "数学与应用数学",
      status: "approved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ], null, 2), "utf8");
  fs.writeFileSync(path.join(legacyRatingDir, "course_reviews.json"), JSON.stringify([
    {
      id: "legacy_review_without_course_id",
      courseName: "线性代数",
      collegeId: "college_math",
      college: "数学学院",
      majorId: "major_math",
      major: "数学与应用数学",
      userId: "legacy_user",
      score: 9,
      difficulty: 6,
      grading: 8,
      workload: 5,
      recommend: 9,
      content: "旧评价没有 courseId，也应该能被迁移到课程实体。",
      tags: ["旧数据"],
      status: "approved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ], null, 2), "utf8");
  fs.writeFileSync(path.join(legacyRatingDir, "course_review_likes.json"), "[]", "utf8");
  delete require.cache[require.resolve(path.join(__dirname, "..", "src", "config.js"))];
  delete require.cache[require.resolve(storePath)];
  const legacyStore = require(storePath);
  const legacyDetail = legacyStore.getCourse("legacy_linear_algebra", "legacy_user");
  assert.strictEqual(legacyDetail.course.courseId, "legacy_linear_algebra");
  assert.strictEqual(legacyDetail.course.reviewCount, 1);
  assert.strictEqual(legacyDetail.reviews[0].courseId, "legacy_linear_algebra");
  console.log("legacyReviewMigrationTest=passed");
  fs.rmSync(legacyDir, { recursive: true, force: true });

  console.log("courseLibraryTest=passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
