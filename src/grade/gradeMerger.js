const { buildGradeFallbackKey, buildGradeKey, normalizeGrade } = require("./gradeNormalizer");

function sourceRank(source) {
  return String(source || "") === "jwxt" ? 2 : 1;
}

function uniqueSources(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])].filter(Boolean).map(item => String(item).toLowerCase())));
}

function mergeSourceScores(left, right) {
  return {
    ...((left && left.sourceScores) || {}),
    ...((right && right.sourceScores) || {})
  };
}

function sourceScoreFor(grade) {
  const source = String(grade.preferredSource || grade.source || "").toLowerCase();
  if (!source || !grade.score) return {};
  return { [source]: grade.score };
}

function choosePreferredSource(left, right) {
  const leftSource = String(left.preferredSource || left.source || "").toLowerCase();
  const rightSource = String(right.preferredSource || right.source || "").toLowerCase();
  return sourceRank(rightSource) > sourceRank(leftSource) ? rightSource : leftSource;
}

function firstNonEmpty(preferred, fallback) {
  return preferred !== undefined && preferred !== null && String(preferred).trim() !== "" ? preferred : fallback;
}

function mergeTwoGrades(existing, incoming) {
  const left = normalizeGrade(existing, existing && existing.source);
  const right = normalizeGrade(incoming, incoming && incoming.source);
  const preferredSource = choosePreferredSource(left, right) || "jwxt";
  const preferred = preferredSource === String(right.preferredSource || right.source).toLowerCase() ? right : left;
  const fallback = preferred === right ? left : right;
  const sources = uniqueSources(left.sources, right.sources);
  const sourceScores = {
    ...mergeSourceScores(left, right),
    ...sourceScoreFor(left),
    ...sourceScoreFor(right)
  };
  const scores = Object.keys(sourceScores).map(key => sourceScores[key]).filter(Boolean);
  const hasConflict = scores.length > 1 && Array.from(new Set(scores)).length > 1;

  return normalizeGrade({
    ...fallback,
    ...preferred,
    courseCode: firstNonEmpty(preferred.courseCode, fallback.courseCode),
    courseName: firstNonEmpty(preferred.courseName, fallback.courseName),
    courseType: firstNonEmpty(preferred.courseType, fallback.courseType),
    score: firstNonEmpty(preferred.score, fallback.score),
    credit: firstNonEmpty(preferred.credit, fallback.credit),
    term: firstNonEmpty(preferred.term, fallback.term),
    source: preferredSource,
    preferredSource,
    sources,
    sourceScores,
    hasConflict
  }, preferredSource);
}

function mergeGrades(existingGrades, incomingGrades) {
  const existing = Array.isArray(existingGrades) ? existingGrades : [];
  const incoming = Array.isArray(incomingGrades) ? incomingGrades : [];
  const map = new Map();
  const aliases = new Map();
  const order = [];
  let duplicate = 0;

  function rememberAliases(canonicalKey, grade) {
    [buildGradeKey(grade), buildGradeFallbackKey(grade)]
      .filter(key => key && key !== "||")
      .forEach(key => aliases.set(key, canonicalKey));
  }

  function canonicalKeyFor(grade) {
    const keys = [buildGradeKey(grade), buildGradeFallbackKey(grade)].filter(key => key && key !== "||");
    for (const key of keys) {
      if (aliases.has(key)) return aliases.get(key);
      if (map.has(key)) return key;
    }
    return keys[0] || "";
  }

  existing.forEach(grade => {
    const normalized = normalizeGrade(grade, grade && grade.source);
    const key = buildGradeKey(normalized);
    if (!key || key === "||") return;
    if (!map.has(key)) order.push(key);
    map.set(key, map.has(key) ? mergeTwoGrades(map.get(key), normalized) : normalized);
    rememberAliases(key, map.get(key));
  });

  incoming.forEach(grade => {
    const normalized = normalizeGrade(grade, grade && grade.source);
    const key = canonicalKeyFor(normalized);
    if (!key || key === "||") return;
    if (map.has(key)) {
      duplicate += 1;
      map.set(key, mergeTwoGrades(map.get(key), normalized));
      rememberAliases(key, map.get(key));
    } else {
      order.push(key);
      map.set(key, normalized);
      rememberAliases(key, normalized);
    }
  });

  return {
    grades: order.map(key => map.get(key)),
    stats: {
      existing: existing.length,
      incoming: incoming.length,
      duplicate,
      final: order.length
    }
  };
}

module.exports = {
  mergeGrades,
  mergeTwoGrades
};
