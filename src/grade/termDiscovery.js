const cheerio = require("cheerio");
const {
  createTerm,
  generateGradeQueryTerms,
  inferAutoTermConfig,
  semesterToXqm,
  xqmToSemester
} = require("../timetable/calendar");

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter(Number.isInteger))).sort((a, b) => a - b);
}

function optionAcademicYear(option) {
  const value = String(option.attr("value") || "").trim();
  const text = String(option.text() || "").trim();
  const valueMatch = value.match(/^(20\d{2})$/);
  if (valueMatch) return Number(valueMatch[1]);
  const textMatch = text.match(/(20\d{2})(?:\s*[-—至]\s*20\d{2})?/);
  return textMatch ? Number(textMatch[1]) : null;
}

function discoverGradeQueryTerms(html) {
  if (typeof html !== "string" || !html.trim()) return [];
  const $ = cheerio.load(html);
  const yearSelects = $("select").filter((index, element) => {
    const field = String($(element).attr("name") || $(element).attr("id") || "").toLowerCase();
    return field === "xnm" || field.includes("xnm");
  });
  if (!yearSelects.length) return [];

  const academicYears = [];
  yearSelects.find("option").each((index, element) => {
    const year = optionAcademicYear($(element));
    if (year) academicYears.push(year);
  });

  const semesterSelects = $("select").filter((index, element) => {
    const field = String($(element).attr("name") || $(element).attr("id") || "").toLowerCase();
    return field === "xqm" || field.includes("xqm");
  });
  const semesters = [];
  semesterSelects.find("option").each((index, element) => {
    const value = String($(element).attr("value") || "").trim();
    const text = String($(element).text() || "").trim();
    const semester = xqmToSemester(value) || (/第?\s*一\s*学期|第?\s*1\s*学期/.test(text) ? 1 : (/第?\s*二\s*学期|第?\s*2\s*学期/.test(text) ? 2 : null));
    if (semester) semesters.push(semester);
  });

  const years = uniqueNumbers(academicYears);
  const semesterNumbers = uniqueNumbers(semesters);
  const availableSemesters = semesterNumbers.length ? semesterNumbers : [1, 2];
  const terms = [];
  years.forEach(year => {
    availableSemesters.forEach(semester => terms.push(createTerm(year, semester)));
  });
  return terms;
}

function resolveGradeQueryTerms(html, cachedGrades, date) {
  const discovered = discoverGradeQueryTerms(html);
  if (discovered.length) {
    return { terms: discovered, source: "SCHOOL" };
  }

  const automatic = inferAutoTermConfig(date);
  return {
    terms: generateGradeQueryTerms(automatic.academicYear, { cachedGrades }),
    source: "FALLBACK"
  };
}

function publicTerm(term) {
  const academicYear = Number(term && (term.academicYear || term.xnm));
  const semester = Number(term && (term.semester || xqmToSemester(term.xqm)));
  return {
    academicYear,
    semester,
    xnm: String(academicYear),
    xqm: semesterToXqm(semester),
    label: academicYear + "-" + (academicYear + 1) + "学年第" + semester + "学期"
  };
}

module.exports = {
  discoverGradeQueryTerms,
  resolveGradeQueryTerms,
  publicTerm
};
