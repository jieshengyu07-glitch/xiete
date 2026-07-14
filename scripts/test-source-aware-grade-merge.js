const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { JsonStorage } = require("../src/db/storage");

function makeJwxtGrade(index, overrides) {
  const termYear = 2023 + Math.floor((index - 1) / 20);
  const termNo = index % 2 === 0 ? "12" : "3";
  return {
    source: "jwxt",
    xnm: String(termYear),
    XNM: String(termYear),
    xqm: termNo,
    XQM: termNo,
    kch: "JWXT" + String(index).padStart(3, "0"),
    KCH: "JWXT" + String(index).padStart(3, "0"),
    kcmc: "Course " + index,
    KCMC: "Course " + index,
    xf: index % 3 === 0 ? "3.00" : "2.00",
    XF: index % 3 === 0 ? "3.00" : "2.00",
    cj: String(60 + (index % 30)),
    CJ: String(60 + (index % 30)),
    ...(overrides || {})
  };
}

function termFromJwxt(grade) {
  const year = Number(grade.xnm || grade.XNM);
  const term = String(grade.xqm || grade.XQM) === "12" ? "2" : "1";
  return year + "-" + (year + 1) + "-" + term;
}

function makeMatchingXgGrade(jwxtGrade, overrides) {
  return {
    source: "xg",
    courseName: jwxtGrade.kcmc || jwxtGrade.KCMC,
    credit: jwxtGrade.xf || jwxtGrade.XF,
    term: termFromJwxt(jwxtGrade),
    score: String(Number(jwxtGrade.cj || jwxtGrade.CJ) - 1),
    ...(overrides || {})
  };
}

function makeXgOnlyGrade(index, overrides) {
  return {
    source: "xg",
    courseName: "XG Candidate " + index,
    credit: index % 2 === 0 ? "2.00" : "3.00",
    term: "2025-2026-" + (index % 2 === 0 ? "1" : "2"),
    score: String(70 + index),
    ...(overrides || {})
  };
}

function makeFixture() {
  const jwxt = Array.from({ length: 60 }, (_, idx) => makeJwxtGrade(idx + 1));
  const xgMatched = jwxt.slice(0, 42).map(makeMatchingXgGrade);
  const xgUnmatched = Array.from({ length: 8 }, (_, idx) => makeXgOnlyGrade(idx + 1));
  return { jwxt, xg: xgMatched.concat(xgUnmatched), xgMatched, xgUnmatched };
}

function withQuietConsole(fn) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

function createStorage(prefix) {
  const filePath = path.join(
    os.tmpdir(),
    (prefix || "source-aware-grade-merge") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".json"
  );
  return { filePath, storage: new JsonStorage(filePath) };
}

function cleanup(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function assertAllXgSource(grades) {
  grades.forEach(grade => {
    assert.strictEqual(grade.preferredSource, "xg");
    assert(Array.isArray(grade.sources) && grade.sources.includes("xg"));
  });
}

function printBoolean(key, value) {
  console.log(key + "=" + Boolean(value));
}

function testJwxtBaselineWithXgFallback() {
  const { filePath, storage } = createStorage("baseline");
  try {
    const { jwxt, xg } = makeFixture();
    withQuietConsole(() => {
      storage.mergeGrades(jwxt);
      const result = storage.mergeXgFallbackGrades(xg);
      const canonical = storage.getGrades();
      const pending = storage.getXgUnmatchedCandidates();

      assert.strictEqual(jwxt.length, 60);
      assert.strictEqual(xg.length, 50);
      assert.strictEqual(result.stats.matched, 42);
      assert.strictEqual(result.stats.candidates, 8);
      assert.strictEqual(canonical.length, 60);
      assert.strictEqual(pending.length, 8);
      assert.strictEqual(result.stats.final - result.stats.existing, 0);

      const merged = canonical.find(grade => grade.courseName === "Course 1");
      assert(merged, "expected matched Course 1 in canonical grades");
      assert.strictEqual(merged.score, "61.00");
      assert.strictEqual(merged.preferredSource, "jwxt");
      assert.deepStrictEqual(merged.sources.sort(), ["jwxt", "xg"]);
      assert.strictEqual(merged.hasConflict, true);
      assert.strictEqual(merged.sourceScores.jwxt, "61.00");
      assert.strictEqual(merged.sourceScores.xg, "60.00");
      assert.strictEqual(storage.getGradeChanges().length, 0);
    });

    console.log("existingJwxtCount=60");
    console.log("incomingXgCount=50");
    console.log("reliableMatchedCount=42");
    console.log("canonical=60");
    console.log("pending=8");
    console.log("addedToCanonical=0");
    console.log("jwxtPriorityPreserved=true");
    console.log("xgUnmatchedDoesNotNotify=true");
  } finally {
    cleanup(filePath);
  }
}

function testNewUserXgOnly() {
  const { filePath, storage } = createStorage("new-user-xg");
  try {
    const { xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeXgFallbackGrades(xg);
      return {
        canonical: storage.getGrades(),
        pending: storage.getXgUnmatchedCandidates()
      };
    });

    console.log("newUserXgOnlyFinal=" + actual.canonical.length);
    console.log("newUserPending=" + actual.pending.length);
    const ok = actual.canonical.length === 50 && actual.pending.length === 0;
    printBoolean("newUserXgSourceTest", ok);
    assert.strictEqual(actual.canonical.length, 50);
    assert.strictEqual(actual.pending.length, 0);
    assertAllXgSource(actual.canonical);
  } finally {
    cleanup(filePath);
  }
}

function testXgThenJwxtReconcile() {
  const { filePath, storage } = createStorage("xg-then-jwxt");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeXgFallbackGrades(xg);
      const firstCanonical = storage.getGrades().length;
      storage.mergeGrades(jwxt);
      const rematch = storage.mergeXgFallbackGrades(storage.getXgUnmatchedCandidates());
      return {
        firstCanonical,
        final: storage.getGrades().length,
        pending: storage.getXgUnmatchedCandidates().length,
        rematch
      };
    });

    console.log("xg50ThenJwxt60FirstFinal=" + actual.firstCanonical);
    console.log("xg50ThenJwxt60Final=" + actual.final);
    console.log("xgOnlyMovedToPending=" + actual.pending);
    const ok = actual.firstCanonical === 50 && actual.final === 60 && actual.pending === 8;
    printBoolean("xgToJwxtReconcileTest", ok);
    assert.strictEqual(actual.firstCanonical, 50);
    assert.strictEqual(actual.final, 60);
    assert.strictEqual(actual.pending, 8);
    assert.notStrictEqual(actual.final, 68);
    assert.notStrictEqual(actual.final, 110);
  } finally {
    cleanup(filePath);
  }
}

function testDuplicatePending() {
  const { filePath, storage } = createStorage("duplicate-pending");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeGrades(jwxt);
      storage.mergeXgFallbackGrades(xg);
      storage.mergeXgFallbackGrades(xg);
      return {
        canonical: storage.getGrades().length,
        pending: storage.getXgUnmatchedCandidates().length
      };
    });

    console.log("duplicatePendingCount=" + actual.pending);
    const ok = actual.canonical === 60 && actual.pending === 8;
    printBoolean("duplicatePendingTest", ok);
    assert.strictEqual(actual.canonical, 60);
    assert.strictEqual(actual.pending, 8);
  } finally {
    cleanup(filePath);
  }
}

function testEmptyFieldProtection() {
  const { filePath, storage } = createStorage("empty-field");
  try {
    const jwxt = makeJwxtGrade(1, {
      kch: "FULL001",
      KCH: "FULL001",
      kcmc: "Full Field Course",
      KCMC: "Full Field Course",
      xf: "4.00",
      XF: "4.00",
      cj: "95",
      CJ: "95"
    });
    const xg = makeMatchingXgGrade(jwxt, {
      studentId: "",
      name: "",
      courseType: "",
      score: "90"
    });
    const merged = withQuietConsole(() => {
      storage.mergeGrades([jwxt]);
      storage.mergeXgFallbackGrades([xg]);
      return storage.getGrades()[0];
    });

    const ok = merged.courseCode === "FULL001" &&
      merged.courseName === "Full Field Course" &&
      merged.term === "2023-2024-1" &&
      merged.credit === "4.00" &&
      merged.score === "95.00";
    printBoolean("emptyFieldProtectionTest", ok);
    assert.strictEqual(merged.courseCode, "FULL001");
    assert.strictEqual(merged.courseName, "Full Field Course");
    assert.strictEqual(merged.term, "2023-2024-1");
    assert.strictEqual(merged.credit, "4.00");
    assert.strictEqual(merged.score, "95.00");
  } finally {
    cleanup(filePath);
  }
}

function testCandidatesHiddenFromGrades() {
  const { filePath, storage } = createStorage("hidden-candidates");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeGrades(jwxt);
      storage.mergeXgFallbackGrades(xg);
      return {
        grades: storage.getGrades(),
        pending: storage.getXgUnmatchedCandidates()
      };
    });

    console.log("getGradesCount=" + actual.grades.length);
    const ok = actual.grades.length === 60 && actual.pending.length === 8;
    printBoolean("candidateHiddenFromGrades", ok);
    assert.strictEqual(actual.grades.length, 60);
    assert.strictEqual(actual.pending.length, 8);
  } finally {
    cleanup(filePath);
  }
}

function testNotificationBoundary() {
  const { filePath, storage } = createStorage("notification");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeGrades(jwxt);
      storage.mergeXgFallbackGrades(xg);
      const afterXgChanges = storage.getGradeChanges().length;
      const realNew = makeJwxtGrade(61, {
        xnm: "2026",
        XNM: "2026",
        xqm: "3",
        XQM: "3",
        kch: "JWXT061",
        KCH: "JWXT061",
        kcmc: "Real New JWXT Course",
        KCMC: "Real New JWXT Course",
        xf: "2.00",
        XF: "2.00",
        cj: "92",
        CJ: "92"
      });
      const diff = storage.diffGrades([realNew]);
      storage.mergeGrades([realNew]);
      return {
        afterXgChanges,
        added: diff.added.length,
        changed: diff.changed.length
      };
    });

    const xgOk = actual.afterXgChanges === 0;
    const jwxtOk = actual.added === 1 && actual.changed === 0;
    printBoolean("xgFallbackNotificationTest", xgOk);
    printBoolean("realJwxtNewGradeNotificationTest", jwxtOk);
    assert.strictEqual(actual.afterXgChanges, 0);
    assert.strictEqual(actual.added, 1);
    assert.strictEqual(actual.changed, 0);
  } finally {
    cleanup(filePath);
  }
}

function testCandidatePersistence() {
  const { filePath, storage } = createStorage("candidate-persistence");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      storage.mergeGrades(jwxt);
      storage.mergeXgFallbackGrades(xg);
      const reloaded = new JsonStorage(filePath);
      const persistedPending = reloaded.getXgUnmatchedCandidates().length;
      reloaded.mergeXgFallbackGrades(xg);
      return {
        persistedPending,
        secondPending: reloaded.getXgUnmatchedCandidates().length
      };
    });

    const ok = actual.persistedPending === 8 && actual.secondPending === 8;
    printBoolean("candidatePersistenceTest", ok);
    assert.strictEqual(actual.persistedPending, 8);
    assert.strictEqual(actual.secondPending, 8);
  } finally {
    cleanup(filePath);
  }
}

function testCandidateUserIsolation() {
  const a = createStorage("user-a");
  const b = createStorage("user-b");
  try {
    const { jwxt, xg } = makeFixture();
    const actual = withQuietConsole(() => {
      a.storage.mergeGrades(jwxt);
      a.storage.mergeXgFallbackGrades(xg);
      b.storage.mergeXgFallbackGrades(xg);
      const reloadedA = new JsonStorage(a.filePath);
      const reloadedB = new JsonStorage(b.filePath);
      return {
        aCanonical: reloadedA.getGrades().length,
        aPending: reloadedA.getXgUnmatchedCandidates().length,
        bCanonical: reloadedB.getGrades().length,
        bPending: reloadedB.getXgUnmatchedCandidates().length
      };
    });

    const ok = actual.aCanonical === 60 &&
      actual.aPending === 8 &&
      actual.bCanonical === 50 &&
      actual.bPending === 0;
    printBoolean("candidateUserIsolationTest", ok);
    assert.strictEqual(actual.aCanonical, 60);
    assert.strictEqual(actual.aPending, 8);
    assert.strictEqual(actual.bCanonical, 50);
    assert.strictEqual(actual.bPending, 0);
  } finally {
    cleanup(a.filePath);
    cleanup(b.filePath);
  }
}

function testCandidateRematchAfterJwxtRecovery() {
  const { filePath, storage } = createStorage("candidate-rematch");
  try {
    const baseJwxt = [makeJwxtGrade(1)];
    const xg = [
      makeMatchingXgGrade(baseJwxt[0]),
      makeXgOnlyGrade(1, {
        courseName: "Recovered Candidate",
        credit: "3.00",
        term: "2025-2026-1",
        score: "88"
      })
    ];
    const recoveredJwxt = makeJwxtGrade(61, {
      xnm: "2025",
      XNM: "2025",
      xqm: "3",
      XQM: "3",
      kch: "JWXT061",
      KCH: "JWXT061",
      kcmc: "Recovered Candidate",
      KCMC: "Recovered Candidate",
      xf: "3.00",
      XF: "3.00",
      cj: "89",
      CJ: "89"
    });

    withQuietConsole(() => {
      storage.mergeGrades(baseJwxt);
      const first = storage.mergeXgFallbackGrades(xg);
      assert.strictEqual(first.stats.matched, 1);
      assert.strictEqual(first.stats.candidates, 1);
      assert.strictEqual(storage.getGrades().length, 1);
      assert.strictEqual(storage.getXgUnmatchedCandidates().length, 1);

      storage.mergeGrades([recoveredJwxt]);
      const second = storage.mergeXgFallbackGrades(storage.getXgUnmatchedCandidates());
      assert.strictEqual(second.stats.matched, 1);
      assert.strictEqual(second.stats.candidates, 0);
      assert.strictEqual(storage.getGrades().length, 2);
      assert.strictEqual(storage.getXgUnmatchedCandidates().length, 0);

      const recovered = storage.getGrades().find(grade => grade.courseName === "Recovered Candidate");
      assert(recovered, "expected recovered candidate in canonical grades");
      assert.strictEqual(recovered.score, "89.00");
      assert.strictEqual(recovered.preferredSource, "jwxt");
      assert.deepStrictEqual(recovered.sources.sort(), ["jwxt", "xg"]);
      assert.strictEqual(recovered.hasConflict, true);
      assert.strictEqual(storage.getGradeChanges().length, 0);
    });

    console.log("candidateRematchMatched=1");
    console.log("candidateRematchPending=0");
    console.log("candidateRematchCanonical=2");
  } finally {
    cleanup(filePath);
  }
}

const tests = [
  ["jwxtBaselineWithXgFallback", testJwxtBaselineWithXgFallback],
  ["newUserXgOnly", testNewUserXgOnly],
  ["xgThenJwxtReconcile", testXgThenJwxtReconcile],
  ["duplicatePending", testDuplicatePending],
  ["emptyFieldProtection", testEmptyFieldProtection],
  ["candidatesHiddenFromGrades", testCandidatesHiddenFromGrades],
  ["notificationBoundary", testNotificationBoundary],
  ["candidatePersistence", testCandidatePersistence],
  ["candidateUserIsolation", testCandidateUserIsolation],
  ["candidateRematchAfterJwxtRecovery", testCandidateRematchAfterJwxtRecovery]
];

const failures = [];
for (const [name, fn] of tests) {
  try {
    fn();
  } catch (err) {
    failures.push(name + ": " + (err && err.message ? err.message : String(err)));
    console.log(name + "=failed");
    console.log(name + "Failure=" + (err && err.message ? err.message : String(err)));
  }
}

if (failures.length) {
  console.log("sourceAwareGradeMergeTest=failed");
  failures.forEach((failure, index) => {
    console.log("failure" + (index + 1) + "=" + failure);
  });
  process.exitCode = 1;
} else {
  console.log("sourceAwareGradeMergeTest=passed");
}
