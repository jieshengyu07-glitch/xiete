const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "rating");
const COURSE_FILE = path.join(DATA_DIR, "courses.json");
const REVIEW_FILE = path.join(DATA_DIR, "course_reviews.json");
const LIKE_FILE = path.join(DATA_DIR, "course_review_likes.json");

const SEED_USER_ID = "system_seed";

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(1));
}

function clampScore(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, n));
}

function normalizeName(value) {
  return String(value || "")
    .replace(/[《》]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanTags(tags) {
  const raw = Array.isArray(tags) ? tags : String(tags || "").split(/[\/,，、\s]+/);
  const seen = new Set();
  return raw.map(tag => cleanText(tag, 12)).filter(tag => {
    if (!tag || seen.has(tag)) return false;
    seen.add(tag);
    return true;
  }).slice(0, 6);
}

function assertSafeReviewContent(content) {
  const text = String(content || "");
  const blockedWords = ["身份证", "手机号", "电话", "微信号", "银行卡", "密码", "住址", "cookie", "token"];
  if (blockedWords.some(word => text.includes(word))) {
    const err = new Error("评价内容不能包含个人隐私或敏感账号信息");
    err.code = "INVALID_REVIEW_INPUT";
    throw err;
  }
  if (/\b1[3-9]\d{9}\b/.test(text) || /\b\d{17}[\dXx]\b/.test(text)) {
    const err = new Error("评价内容不能包含手机号或身份证号");
    err.code = "INVALID_REVIEW_INPUT";
    throw err;
  }
}

function seedData() {
  const at = nowIso();
  const courses = [
    {
      id: "course_auto_theory",
      name: "汽车理论",
      normalizedName: normalizeName("汽车理论"),
      college: "车辆与交通工程学院",
      major: "车辆工程",
      type: "必修",
      term: "大三下",
      description: "汽车动力性、制动性和燃油经济性相关课程。",
      createdByUserId: SEED_USER_ID,
      status: "approved",
      ratingAvg: 7.4,
      difficultyAvg: 8.2,
      gradingAvg: 6.9,
      workloadAvg: 7.6,
      recommendAvg: 7.8,
      reviewCount: 1,
      likeCount: 128,
      createdAt: at,
      updatedAt: at
    },
    {
      id: "course_new_energy_intro",
      name: "新能源汽车概论",
      normalizedName: normalizeName("新能源汽车概论"),
      college: "车辆与交通工程学院",
      major: "车辆工程",
      type: "选修",
      term: "大二下",
      description: "新能源汽车基础、动力电池和驱动系统概论。",
      createdByUserId: SEED_USER_ID,
      status: "approved",
      ratingAvg: 8.6,
      difficultyAvg: 5.8,
      gradingAvg: 8.7,
      workloadAvg: 4.6,
      recommendAvg: 8.9,
      reviewCount: 1,
      likeCount: 96,
      createdAt: at,
      updatedAt: at
    },
    {
      id: "course_advanced_math_a",
      name: "高等数学A",
      normalizedName: normalizeName("高等数学A"),
      college: "应用科学学院",
      major: "公共基础课",
      type: "必修",
      term: "大一上",
      description: "工科基础数学课程。",
      createdByUserId: SEED_USER_ID,
      status: "approved",
      ratingAvg: 6.8,
      difficultyAvg: 8.8,
      gradingAvg: 6.1,
      workloadAvg: 8.0,
      recommendAvg: 6.4,
      reviewCount: 1,
      likeCount: 88,
      createdAt: at,
      updatedAt: at
    }
  ];
  const reviews = [
    {
      id: "review_auto_theory_hot",
      courseId: "course_auto_theory",
      userId: SEED_USER_ID,
      score: 7.4,
      difficulty: 8.2,
      grading: 6.9,
      workload: 7.6,
      recommend: 7.8,
      content: "计算题一定要提前练，动力性和制动性很重要。",
      tags: ["考试难", "计算多", "闭卷"],
      likeCount: 128,
      status: "approved",
      createdAt: at,
      updatedAt: at
    },
    {
      id: "review_new_energy_hot",
      courseId: "course_new_energy_intro",
      userId: SEED_USER_ID,
      score: 8.6,
      difficulty: 5.8,
      grading: 8.7,
      workload: 4.6,
      recommend: 8.9,
      content: "老师画的星号内容比较重要，开卷也不能完全裸考。",
      tags: ["重点明确", "好过", "开卷"],
      likeCount: 96,
      status: "approved",
      createdAt: at,
      updatedAt: at
    },
    {
      id: "review_advanced_math_hot",
      courseId: "course_advanced_math_a",
      userId: SEED_USER_ID,
      score: 6.8,
      difficulty: 8.8,
      grading: 6.1,
      workload: 8.0,
      recommend: 6.4,
      content: "别等期末才开始，高数真不能纯靠突击。",
      tags: ["难度高", "需要刷题", "闭卷"],
      likeCount: 88,
      status: "approved",
      createdAt: at,
      updatedAt: at
    }
  ];
  return { courses, reviews, likes: [] };
}

function loadAll() {
  const seed = seedData();
  const courses = readJson(COURSE_FILE, seed.courses);
  const reviews = readJson(REVIEW_FILE, seed.reviews);
  const likes = readJson(LIKE_FILE, seed.likes);
  if (!fs.existsSync(COURSE_FILE)) writeJson(COURSE_FILE, courses);
  if (!fs.existsSync(REVIEW_FILE)) writeJson(REVIEW_FILE, reviews);
  if (!fs.existsSync(LIKE_FILE)) writeJson(LIKE_FILE, likes);
  return { courses, reviews, likes };
}

function saveAll(data) {
  writeJson(COURSE_FILE, data.courses);
  writeJson(REVIEW_FILE, data.reviews);
  writeJson(LIKE_FILE, data.likes);
}

function approvedReviews(data, courseId) {
  return data.reviews.filter(item => item.courseId === courseId && item.status !== "deleted");
}

function recalcCourse(data, courseId) {
  const course = data.courses.find(item => item.id === courseId);
  if (!course) return;
  const reviews = approvedReviews(data, courseId);
  course.reviewCount = reviews.length;
  course.likeCount = reviews.reduce((sum, item) => sum + Math.max(0, Number(item.likeCount) || 0), 0);
  if (reviews.length) {
    course.ratingAvg = round(reviews.reduce((sum, item) => sum + Number(item.score || 0), 0) / reviews.length);
    course.difficultyAvg = round(reviews.reduce((sum, item) => sum + Number(item.difficulty || 0), 0) / reviews.length);
    course.gradingAvg = round(reviews.reduce((sum, item) => sum + Number(item.grading || 0), 0) / reviews.length);
    course.workloadAvg = round(reviews.reduce((sum, item) => sum + Number(item.workload || 0), 0) / reviews.length);
    course.recommendAvg = round(reviews.reduce((sum, item) => sum + Number(item.recommend || 0), 0) / reviews.length);
  }
  course.updatedAt = nowIso();
}

function tagsForCourse(data, courseId) {
  const counts = new Map();
  approvedReviews(data, courseId).forEach(review => {
    (review.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(item => item[0])
    .slice(0, 4);
}

function hotReviewForCourse(data, courseId) {
  return approvedReviews(data, courseId)
    .sort((a, b) => Number(b.likeCount || 0) - Number(a.likeCount || 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

function isLiked(data, reviewId, userId) {
  if (!userId) return false;
  return data.likes.some(item => item.reviewId === reviewId && item.userId === userId);
}

function reviewDto(data, review, userId) {
  return {
    id: review.id,
    courseId: review.courseId,
    score: round(review.score),
    difficulty: round(review.difficulty),
    grading: round(review.grading),
    workload: round(review.workload),
    recommend: round(review.recommend),
    content: review.content,
    tags: review.tags || [],
    likeCount: Math.max(0, Number(review.likeCount) || 0),
    liked: isLiked(data, review.id, userId),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt
  };
}

function courseDto(data, course) {
  const hot = hotReviewForCourse(data, course.id);
  return {
    id: course.id,
    name: course.name,
    college: course.college,
    major: course.major,
    type: course.type,
    term: course.term,
    description: course.description || "",
    score: round(course.ratingAvg),
    ratingAvg: round(course.ratingAvg),
    difficultyAvg: round(course.difficultyAvg),
    gradingAvg: round(course.gradingAvg),
    workloadAvg: round(course.workloadAvg),
    recommendAvg: round(course.recommendAvg),
    reviewCount: Number(course.reviewCount) || 0,
    likeCount: Number(course.likeCount) || 0,
    tags: tagsForCourse(data, course.id),
    hotReview: hot ? hot.content : "",
    createdAt: course.createdAt,
    updatedAt: course.updatedAt
  };
}

function rankCourses(limit) {
  const data = loadAll();
  return data.courses
    .filter(item => item.status !== "deleted")
    .map(course => courseDto(data, course))
    .sort((a, b) => b.likeCount - a.likeCount || b.reviewCount - a.reviewCount || b.score - a.score)
    .slice(0, Number(limit) || 10)
    .map((item, index) => Object.assign({ rank: index + 1 }, item));
}

function hotCourseReviews(limit) {
  const data = loadAll();
  return data.reviews
    .filter(item => item.status !== "deleted")
    .map(review => {
      const course = data.courses.find(item => item.id === review.courseId);
      if (!course || course.status === "deleted") return null;
      return {
        id: review.id,
        courseId: course.id,
        name: course.name,
        score: round(course.ratingAvg),
        reviewCount: Number(course.reviewCount) || 0,
        likeCount: Number(review.likeCount) || 0,
        tags: review.tags || [],
        quote: review.content
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, Number(limit) || 10)
    .map((item, index) => Object.assign({ rank: index + 1, rankText: "TOP " + (index + 1) }, item));
}

function searchCourses(keyword, limit) {
  const data = loadAll();
  const key = normalizeName(keyword);
  return data.courses
    .filter(item => item.status !== "deleted")
    .filter(item => !key || item.normalizedName.includes(key) || normalizeName(item.college).includes(key) || normalizeName(item.major).includes(key))
    .map(course => courseDto(data, course))
    .sort((a, b) => b.likeCount - a.likeCount || b.reviewCount - a.reviewCount)
    .slice(0, Number(limit) || 20);
}

function getCourse(courseId, userId) {
  const data = loadAll();
  const course = data.courses.find(item => item.id === courseId && item.status !== "deleted");
  if (!course) return null;
  const reviews = listReviews(courseId, "hot", userId);
  return {
    course: courseDto(data, course),
    dimensions: [
      { label: "课程难度", value: round(course.difficultyAvg) },
      { label: "给分友好", value: round(course.gradingAvg) },
      { label: "作业量", value: round(course.workloadAvg) },
      { label: "推荐程度", value: round(course.recommendAvg) }
    ],
    guide: [],
    papers: [],
    resources: [],
    reviews
  };
}

function listReviews(courseId, sort, userId) {
  const data = loadAll();
  return approvedReviews(data, courseId)
    .sort((a, b) => {
      if (sort === "latest") return String(b.updatedAt).localeCompare(String(a.updatedAt));
      return Number(b.likeCount || 0) - Number(a.likeCount || 0) || String(b.updatedAt).localeCompare(String(a.updatedAt));
    })
    .map(review => reviewDto(data, review, userId));
}

function addCourse(input, userId) {
  const data = loadAll();
  const name = cleanText(input.name, 60);
  const college = cleanText(input.college, 60);
  const major = cleanText(input.major, 60);
  if (!name || !college || !major) {
    const err = new Error("课程名称、所属学院和所属专业不能为空");
    err.code = "INVALID_COURSE_INPUT";
    throw err;
  }
  const normalizedName = normalizeName(name);
  const exists = data.courses.find(item => item.normalizedName === normalizedName && item.status !== "deleted");
  if (exists) return { course: courseDto(data, exists), duplicated: true };
  const at = nowIso();
  const course = {
    id: id("course"),
    name,
    normalizedName,
    college,
    major,
    type: cleanText(input.type, 20) || "不确定",
    term: cleanText(input.term, 20) || "不确定",
    description: cleanText(input.description || input.remark, 200),
    createdByUserId: userId,
    status: "approved",
    ratingAvg: 0,
    difficultyAvg: 0,
    gradingAvg: 0,
    workloadAvg: 0,
    recommendAvg: 0,
    reviewCount: 0,
    likeCount: 0,
    createdAt: at,
    updatedAt: at
  };
  data.courses.push(course);
  saveAll(data);
  return { course: courseDto(data, course), duplicated: false };
}

function upsertReview(courseId, userId, input) {
  const data = loadAll();
  const course = data.courses.find(item => item.id === courseId && item.status !== "deleted");
  if (!course) {
    const err = new Error("课程不存在");
    err.code = "COURSE_NOT_FOUND";
    throw err;
  }
  const content = cleanText(input.content, 300);
  if (!content) {
    const err = new Error("评价内容不能为空");
    err.code = "INVALID_REVIEW_INPUT";
    throw err;
  }
  assertSafeReviewContent(content);
  const at = nowIso();
  let review = data.reviews.find(item => item.courseId === courseId && item.userId === userId && item.status !== "deleted");
  if (!review) {
    review = {
      id: id("review"),
      courseId,
      userId,
      likeCount: 0,
      status: "approved",
      createdAt: at
    };
    data.reviews.push(review);
  }
  review.score = clampScore(input.score, 8);
  review.difficulty = clampScore(input.difficulty, review.score);
  review.grading = clampScore(input.grading, review.score);
  review.workload = clampScore(input.workload, review.score);
  review.recommend = clampScore(input.recommend, review.score);
  review.content = content;
  review.tags = cleanTags(input.tags);
  review.updatedAt = at;
  recalcCourse(data, courseId);
  saveAll(data);
  return { review: reviewDto(data, review, userId), course: courseDto(data, course) };
}

function toggleLike(reviewId, userId) {
  const data = loadAll();
  const review = data.reviews.find(item => item.id === reviewId && item.status !== "deleted");
  if (!review) {
    const err = new Error("评价不存在");
    err.code = "REVIEW_NOT_FOUND";
    throw err;
  }
  const index = data.likes.findIndex(item => item.reviewId === reviewId && item.userId === userId);
  let liked;
  if (index >= 0) {
    data.likes.splice(index, 1);
    review.likeCount = Math.max(0, Number(review.likeCount || 0) - 1);
    liked = false;
  } else {
    data.likes.push({ id: id("like"), reviewId, userId, createdAt: nowIso() });
    review.likeCount = Math.max(0, Number(review.likeCount || 0) + 1);
    liked = true;
  }
  review.updatedAt = nowIso();
  recalcCourse(data, review.courseId);
  saveAll(data);
  return { reviewId, likeCount: Number(review.likeCount) || 0, liked };
}

function home() {
  return {
    hotCourseReviews: hotCourseReviews(5),
    hotFoodReviews: [
      {
        rank: 1,
        rankText: "TOP 1",
        name: "一餐麻辣香锅",
        canteen: "一餐",
        score: 9.1,
        reviewCount: 84,
        likeCount: 102,
        tags: ["量大", "好吃", "排队久"],
        quote: "下课晚了就别去了，排队真的挺长。"
      },
      {
        rank: 2,
        rankText: "TOP 2",
        name: "二餐黄焖鸡",
        canteen: "二餐",
        score: 8.4,
        reviewCount: 37,
        likeCount: 76,
        tags: ["稳定", "管饱", "性价比高"],
        quote: "不知道吃啥的时候选它一般不会踩雷。"
      },
      {
        rank: 3,
        rankText: "TOP 3",
        name: "炸鸡饭",
        canteen: "一餐",
        score: 8.7,
        reviewCount: 42,
        likeCount: 69,
        tags: ["香", "分量足", "偏油"],
        quote: "味道可以，但是吃多了有点腻。"
      }
    ]
  };
}

module.exports = {
  addCourse,
  getCourse,
  home,
  hotCourseReviews,
  listReviews,
  rankCourses,
  searchCourses,
  toggleLike,
  upsertReview
};
