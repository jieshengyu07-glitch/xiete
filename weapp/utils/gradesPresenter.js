function pick(item, keys, fallback) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = item && item[keys[i]];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback === undefined ? "" : fallback;
}

function semesterOf(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text === "3" || text === "1") return 1;
  if (text === "12" || text === "2") return 2;
  return 0;
}

function termParts(item) {
  const academicYear = Number(pick(item, ["academicYear", "xnm", "XNM"], 0));
  const semester = Number(pick(item, ["semester"], 0)) || semesterOf(pick(item, ["xqm", "XQM"], ""));
  return {
    academicYear: Number.isInteger(academicYear) ? academicYear : 0,
    semester
  };
}

function termKey(item) {
  const term = termParts(item);
  return term.academicYear && term.semester ? term.academicYear + "_" + (term.semester === 1 ? "3" : "12") : "";
}

function termLabel(item) {
  const term = termParts(item);
  if (!term.academicYear || !term.semester) {
    return String(pick(item, ["termName", "term", "label"], "未分组"));
  }
  return term.academicYear + "-" + (term.academicYear + 1) + "学年 第" + (term.semester === 1 ? "一" : "二") + "学期";
}

function trimNumber(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return text;
  return text.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function normalizeGrade(grade, index) {
  const courseName = String(pick(grade, ["courseName", "kcmc", "KCMC", "name", "课程名称"], "课程名称待定"));
  const score = String(pick(grade, ["score", "cj", "CJ", "grade", "成绩"], "待发布"));
  const credit = trimNumber(pick(grade, ["credit", "xf", "XF", "credits", "学分"], ""));
  const courseType = String(pick(grade, ["courseType", "kcxz", "KCXZ", "type", "课程性质"], ""));
  const metadata = [];
  if (credit) metadata.push(credit + " 学分");
  if (courseType) metadata.push(courseType);
  return {
    id: String(pick(grade, ["id"], "")) || termKey(grade) + "_" + courseName + "_" + index,
    courseName,
    score,
    metaText: metadata.join(" · "),
    raw: grade
  };
}

function compareTerms(a, b) {
  if (b.academicYear !== a.academicYear) return b.academicYear - a.academicYear;
  return b.semester - a.semester;
}

function presentGrades(input, selectedKey) {
  const data = input || {};
  const rawGrades = Array.isArray(data.grades) ? data.grades : [];
  const rawGroups = Array.isArray(data.groupedGrades) ? data.groupedGrades : [];
  const availableTerms = Array.isArray(data.availableTerms) ? data.availableTerms : [];
  const terms = new Map();

  availableTerms.forEach(term => {
    const key = termKey(term);
    const parts = termParts(term);
    if (key) terms.set(key, { key, ...parts, termName: termLabel(term), grades: [] });
  });

  rawGroups.forEach(group => {
    const sample = (group.grades || [])[0] || {};
    const key = termKey(group) || termKey(sample);
    if (!key) return;
    const parts = termParts(group.xnm || group.xqm ? group : sample);
    const normalized = (group.grades || []).map(normalizeGrade);
    const current = terms.get(key) || { key, ...parts, termName: termLabel(group.xnm || group.xqm ? group : sample), grades: [] };
    current.grades = normalized;
    terms.set(key, current);
  });

  if (!rawGroups.length) {
    rawGrades.forEach((grade, index) => {
      const key = termKey(grade);
      if (!key) return;
      const parts = termParts(grade);
      const current = terms.get(key) || { key, ...parts, termName: termLabel(grade), grades: [] };
      current.grades.push(normalizeGrade(grade, index));
      terms.set(key, current);
    });
  }

  const groups = Array.from(terms.values()).sort(compareTerms);
  let activeIndex = groups.findIndex(group => group.key === selectedKey);
  if (activeIndex < 0) activeIndex = groups.findIndex(group => group.grades.length > 0);
  if (activeIndex < 0 && groups.length) activeIndex = 0;
  const currentGroup = groups[activeIndex] || null;
  const totalCount = rawGrades.length || rawGroups.reduce((sum, group) => sum + (group.grades || []).length, 0);

  return {
    grades: rawGrades,
    groupedGrades: groups,
    termLabels: groups.map(group => group.termName),
    activeTermIndex: Math.max(activeIndex, 0),
    currentGroup,
    currentGrades: currentGroup ? currentGroup.grades : [],
    totalCount,
    emptyState: totalCount === 0 ? "NO_DATA" : (currentGroup && currentGroup.grades.length === 0 ? "EMPTY_TERM" : "HAS_DATA")
  };
}

module.exports = {
  semesterOf,
  termKey,
  termLabel,
  normalizeGrade,
  presentGrades
};
