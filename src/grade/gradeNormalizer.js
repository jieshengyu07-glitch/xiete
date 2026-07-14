function cleanText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\u3000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(grade, keys) {
  for (const key of keys) {
    const value = grade && grade[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeNumberText(value, decimals) {
  const text = cleanText(value);
  if (!text) return "";
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  return n.toFixed(decimals);
}

function normalizeScore(value) {
  return normalizeNumberText(value, 2);
}

function normalizeCredit(value) {
  return normalizeNumberText(value, 2);
}

function termFromXnmXqm(xnm, xqm) {
  const year = cleanText(xnm);
  const semester = cleanText(xqm);
  if (!/^\d{4}$/.test(year)) return "";
  let termNo = "";
  if (semester === "3" || semester === "1") termNo = "1";
  else if (semester === "12" || semester === "2") termNo = "2";
  else if (semester) termNo = semester;
  if (!termNo) return "";
  return year + "-" + (Number(year) + 1) + "-" + termNo;
}

function normalizeTerm(value, grade) {
  const direct = cleanText(value);
  const xnm = cleanText(firstValue(grade, ["xnm", "XNM"]));
  const xqm = cleanText(firstValue(grade, ["xqm", "XQM"]));
  const fromParams = termFromXnmXqm(xnm, xqm);

  if (direct) {
    let match = direct.match(/(\d{4})\s*-\s*(\d{4})\s*-\s*([12])/);
    if (match) return match[1] + "-" + match[2] + "-" + match[3];

    match = direct.match(/(\d{4})\s*-\s*(\d{4})\s*学年\s*第?\s*([12])\s*学期/);
    if (match) return match[1] + "-" + match[2] + "-" + match[3];

    match = direct.match(/(\d{4})\s*学年\s*第?\s*([12])\s*学期/);
    if (match) return match[1] + "-" + (Number(match[1]) + 1) + "-" + match[2];
  }

  return fromParams || direct;
}

function xnmFromTerm(term) {
  const match = cleanText(term).match(/^(\d{4})-\d{4}-[12]$/);
  return match ? match[1] : "";
}

function xqmFromTerm(term) {
  const match = cleanText(term).match(/^\d{4}-\d{4}-([12])$/);
  if (!match) return "";
  return match[1] === "1" ? "3" : "12";
}

function normalizeSources(grade, source) {
  const values = [];
  if (Array.isArray(grade && grade.sources)) values.push(...grade.sources);
  if (grade && grade.preferredSource) values.push(grade.preferredSource);
  if (grade && grade.source) values.push(grade.source);
  if (source) values.push(source);
  const normalized = values
    .map(item => cleanText(item).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeGrade(grade, source) {
  const item = grade || {};
  const courseCode = cleanText(firstValue(item, ["courseCode", "KCH", "kch", "KCDM", "kcdm"]));
  const courseName = cleanText(firstValue(item, ["courseName", "KCMC", "kcmc", "course", "name"]));
  const courseType = cleanText(firstValue(item, ["courseType", "KCXZ", "kcxz", "type"]));
  const score = normalizeScore(firstValue(item, ["score", "CJ", "cj", "grade"]));
  const credit = normalizeCredit(firstValue(item, ["credit", "XF", "xf", "credits"]));
  const term = normalizeTerm(firstValue(item, ["term", "termName", "semester"]), item);
  const xnm = cleanText(firstValue(item, ["xnm", "XNM"])) || xnmFromTerm(term);
  const xqm = cleanText(firstValue(item, ["xqm", "XQM"])) || xqmFromTerm(term);
  const sources = normalizeSources(item, source);
  const preferredSource = cleanText(item.preferredSource).toLowerCase() || (sources.includes("jwxt") ? "jwxt" : (sources[0] || cleanText(source).toLowerCase() || "jwxt"));

  return {
    ...item,
    courseCode,
    courseName,
    courseType,
    score,
    credit,
    term,
    source: preferredSource,
    preferredSource,
    sources: sources.length ? sources : [preferredSource],
    KCH: courseCode,
    kch: courseCode,
    KCMC: courseName,
    kcmc: courseName,
    KCXZ: courseType,
    kcxz: courseType,
    CJ: score,
    cj: score,
    XF: credit,
    xf: credit,
    XNM: xnm,
    xnm,
    XQM: xqm,
    xqm
  };
}

function buildGradeKey(grade) {
  const normalized = normalizeGrade(grade, grade && grade.source);
  if (normalized.term && normalized.courseCode) {
    return normalized.term + "|" + normalized.courseCode;
  }
  return buildGradeFallbackKey(normalized);
}

function buildGradeFallbackKey(grade) {
  const normalized = normalizeGrade(grade, grade && grade.source);
  return [
    normalized.term,
    normalized.courseName,
    normalized.credit
  ].join("|");
}

module.exports = {
  cleanText,
  normalizeGrade,
  buildGradeKey,
  buildGradeFallbackKey,
  normalizeScore,
  normalizeCredit,
  normalizeTerm,
  termFromXnmXqm
};
