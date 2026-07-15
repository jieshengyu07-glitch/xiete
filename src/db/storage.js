const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getUserPaths } = require('../services/userPaths');
const { buildGradeFallbackKey, buildGradeKey, normalizeGrade } = require('../grade/gradeNormalizer');
const { mergeGrades: mergeGradeCollections } = require('../grade/gradeMerger');

class JsonStorage {
  constructor(filePath) {
    this.filePath = filePath || path.join(config.dataDir, 'campus.json');
    this.dataDir = path.dirname(this.filePath);
    this.data = null;
    this._ensureDataDir();
    this._load();
  }

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.data = this._getDefaultData();
        this._save();
      }
    } catch (err) {
      if (err && (err.code === 'STORAGE_WRITE_FAILED' || err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOSPC')) throw err;
      console.error('[存储] 读取数据文件失败，使用默认数据:', err.message);
      this.data = this._getDefaultData();
    }
  }

  _save() {
    const temporary = this.filePath + '.tmp-' + process.pid + '-' + Date.now();
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(temporary, this.filePath);
    } catch (err) {
      console.error('[存储] 保存数据文件失败:', err.message);
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch (cleanupErr) {}
      err.code = err.code || 'STORAGE_WRITE_FAILED';
      throw err;
    }
  }

  _getDefaultData() {
    return {
      grades: [],         // 已出成绩
      gradeChanges: [],   // 成绩变化记录
      timetable: [],      // 课表缓存
      evaluation: {       // 评教状态
        status: 'unknown', // unknown | pending | completed
        lastCheckedAt: null,
      },
      syncMeta: {
        grades: {},
        timetable: {},
      },
      xgSession: {
        scoreUrl: "",
        cookies: "",
        updatedAt: null,
      },
      xgUnmatchedCandidates: [],
      lastRunAt: null,    // 上次运行时间
    };
  }

  _ensureShape() {
    if (!this.data) this.data = this._getDefaultData();
    if (!Array.isArray(this.data.grades)) this.data.grades = [];
    if (!Array.isArray(this.data.gradeChanges)) this.data.gradeChanges = [];
    if (!Array.isArray(this.data.timetable)) this.data.timetable = [];
    if (!this.data.syncMeta || typeof this.data.syncMeta !== 'object') this.data.syncMeta = {};
    if (!this.data.syncMeta.grades) this.data.syncMeta.grades = {};
    if (!this.data.syncMeta.timetable) this.data.syncMeta.timetable = {};
    if (!this.data.xgSession || typeof this.data.xgSession !== 'object') {
      this.data.xgSession = { scoreUrl: "", cookies: "", updatedAt: null };
    }
    if (!Array.isArray(this.data.xgUnmatchedCandidates)) this.data.xgUnmatchedCandidates = [];
  }

  _value(grade, lower, upper) {
    if (!grade) return '';
    return grade[lower] !== undefined && grade[lower] !== null ? grade[lower] :
      (grade[upper] !== undefined && grade[upper] !== null ? grade[upper] : '');
  }

  _gradeKey(grade) {
    return buildGradeKey(grade);
  }

  _score(grade) {
    return normalizeGrade(grade, grade && grade.source).score;
  }

  _courseName(grade) {
    return normalizeGrade(grade, grade && grade.source).courseName;
  }

  _xnm(grade) {
    return normalizeGrade(grade, grade && grade.source).xnm;
  }

  _xqm(grade) {
    return normalizeGrade(grade, grade && grade.source).xqm;
  }

  _hasSource(grade, source) {
    const normalized = normalizeGrade(grade, grade && grade.source);
    return normalized.source === source || normalized.sources.includes(source);
  }

  _hasJwxtBaseline(grades) {
    return (Array.isArray(grades) ? grades : []).some(grade => this._hasSource(grade, 'jwxt'));
  }

  _matchesAnyGrade(grade, candidates) {
    const gradeKey = this._gradeKey(grade);
    const fallbackKey = buildGradeFallbackKey(grade);
    return (Array.isArray(candidates) ? candidates : []).some(candidate =>
      this._gradeKey(candidate) === gradeKey ||
      buildGradeFallbackKey(candidate) === fallbackKey
    );
  }

  // ========== 学工成绩渠道 ==========

  saveXgSession(scoreUrl, cookies) {
    this._load();
    this._ensureShape();
    this.data.xgSession = {
      scoreUrl: String(scoreUrl || "").trim(),
      cookies: String(cookies || "").trim(),
      updatedAt: new Date().toISOString()
    };
    this._save();
  }

  getXgSession() {
    this._load();
    this._ensureShape();
    return this.data.xgSession || { scoreUrl: "", cookies: "", updatedAt: null };
  }

  hasXgSession() {
    const session = this.getXgSession();
    return Boolean(session.scoreUrl && session.cookies);
  }

  getXgUnmatchedCandidates() {
    this._load();
    this._ensureShape();
    return this.data.xgUnmatchedCandidates;
  }

  replaceXgUnmatchedCandidates(candidates) {
    this._load();
    this._ensureShape();
    this.data.xgUnmatchedCandidates = (Array.isArray(candidates) ? candidates : [])
      .map(grade => normalizeGrade({ ...grade, source: 'xg' }, 'xg'));
    this._save();
  }

  // ========== 成绩相关 ==========

  // 获取所有已存储的成绩
  getGrades() {
    this._load();
    this._ensureShape();
    return this.data.grades;
  }

  // 获取指定学期的成绩
  getGradesByTerm(xnm, xqm) {
    return this.data.grades.filter(g => g.xnm === xnm && g.xqm === xqm);
  }

  // 对比新成绩，返回变化（新增/修改）
  diffGrades(newGrades) {
    this._load();
    this._ensureShape();
    const existing = this.data.grades.map(g => normalizeGrade(g, g && g.source));
    const incoming = (Array.isArray(newGrades) ? newGrades : []).map(g => normalizeGrade(g, g && g.source));
    const added = [];
    const changed = [];

    console.log('[diff] oldGrades=' + existing.length);
    console.log('[diff] newGrades=' + incoming.length);

    for (const ng of incoming) {
      const newKey = this._gradeKey(ng);
      const fallbackKey = buildGradeFallbackKey(ng);
      const old = existing.find(e => this._gradeKey(e) === newKey || buildGradeFallbackKey(e) === fallbackKey);
      if (!old) {
        added.push(ng);
      } else {
        const merged = mergeGradeCollections([old], [ng]).grades[0] || ng;
        const oldScore = this._score(old);
        const mergedScore = this._score(merged);
        if (!oldScore && mergedScore) {
          added.push(merged);
        } else if (oldScore !== mergedScore) {
        changed.push({
          old: oldScore,
          new: mergedScore,
          course: this._courseName(ng),
          oldGrade: old,
          newGrade: merged,
          oldCj: oldScore,
          newCj: mergedScore,
          kcmc: this._courseName(ng),
          xnm: this._xnm(ng),
          xqm: this._xqm(ng)
        });
        }
      }
    }

    console.log('[diff] added=' + added.length);
    console.log('[diff] changed=' + changed.length);
    return { added, changed };
  }

  // 合并新成绩到存储
  mergeGrades(newGrades) {
    this._ensureShape();
    const existing = this.data.grades.map(g => normalizeGrade(g, g && g.source));
    const incoming = (Array.isArray(newGrades) ? newGrades : []).map(g => normalizeGrade(g, g && g.source));
    const incomingHasJwxt = this._hasJwxtBaseline(incoming);
    const existingHasJwxt = this._hasJwxtBaseline(existing);
    let mergeBase = this.data.grades;
    let movedXgCandidates = [];

    if (incomingHasJwxt && !existingHasJwxt && existing.length) {
      const matchedExisting = [];
      const unmatchedExisting = [];
      existing.forEach(grade => {
        if (this._hasSource(grade, 'xg') && !this._matchesAnyGrade(grade, incoming)) {
          unmatchedExisting.push(grade);
        } else {
          matchedExisting.push(grade);
        }
      });
      mergeBase = matchedExisting;
      movedXgCandidates = unmatchedExisting;
    }

    const result = mergeGradeCollections(mergeBase, incoming);
    const added = Math.max(0, result.stats.final - result.stats.existing);
    const changed = Math.max(0, result.stats.incoming - result.stats.duplicate - added);
    console.log('[grade-merge] existing=' + result.stats.existing + ' incoming=' + result.stats.incoming);
    console.log('[grade-merge] duplicate=' + result.stats.duplicate);
    console.log('[grade-merge] added=' + added);
    console.log('[grade-merge] changed=' + changed);
    console.log('[grade-merge] final=' + result.stats.final);
    this.data.grades = result.grades;
    if (movedXgCandidates.length) {
      this.data.xgUnmatchedCandidates = movedXgCandidates;
      console.log('[grade-merge] movedXgCandidates=' + movedXgCandidates.length);
    }
    this.data.syncMeta.grades.lastSuccessfulSyncAt = new Date().toISOString();
    this.data.syncMeta.grades.lastError = null;
    this.data.syncMeta.grades.lastErrorMessage = null;
    this._save();
  }

  mergeXgFallbackGrades(newGrades) {
    this._load();
    this._ensureShape();
    const existing = this.data.grades.map(g => normalizeGrade(g, g && g.source));
    const incoming = (Array.isArray(newGrades) ? newGrades : [])
      .map(g => normalizeGrade({ ...g, source: 'xg' }, 'xg'));
    const matched = [];
    const unmatched = [];
    const hasJwxtBaseline = this._hasJwxtBaseline(existing);

    if (!hasJwxtBaseline) {
      const result = mergeGradeCollections(this.data.grades, incoming);
      console.log('[grade-merge] mode=xg-canonical existing=' + result.stats.existing + ' incoming=' + incoming.length);
      console.log('[grade-merge] mode=xg-canonical final=' + result.stats.final);
      this.data.grades = result.grades;
      this.data.xgUnmatchedCandidates = [];
      this.data.syncMeta.grades.lastSuccessfulSyncAt = new Date().toISOString();
      this.data.syncMeta.grades.lastError = null;
      this.data.syncMeta.grades.lastErrorMessage = null;
      this._save();
      return {
        merged: incoming,
        candidates: [],
        final: result.grades,
        stats: {
          existing: result.stats.existing,
          incoming: incoming.length,
          matched: incoming.length,
          candidates: 0,
          final: result.stats.final
        }
      };
    }

    for (const grade of incoming) {
      if (this._matchesAnyGrade(grade, existing)) matched.push(grade);
      else unmatched.push(grade);
    }

    const result = mergeGradeCollections(this.data.grades, matched);
    console.log('[grade-merge] mode=xg-fallback existing=' + result.stats.existing + ' incoming=' + incoming.length);
    console.log('[grade-merge] mode=xg-fallback matched=' + matched.length);
    console.log('[grade-merge] mode=xg-fallback candidates=' + unmatched.length);
    console.log('[grade-merge] mode=xg-fallback final=' + result.stats.final);
    this.data.grades = result.grades;
    this.data.xgUnmatchedCandidates = unmatched;
    this.data.syncMeta.grades.lastSuccessfulSyncAt = new Date().toISOString();
    this.data.syncMeta.grades.lastError = null;
    this.data.syncMeta.grades.lastErrorMessage = null;
    this._save();
    return {
      merged: matched,
      candidates: unmatched,
      final: result.grades,
      stats: {
        existing: result.stats.existing,
        incoming: incoming.length,
        matched: matched.length,
        candidates: unmatched.length,
        final: result.stats.final
      }
    };
  }

  // 记录成绩变化
  addGradeChange(change) {
    this.data.gradeChanges.push({
      ...change,
      createdAt: change.createdAt || new Date().toISOString(),
      detectedAt: change.detectedAt || new Date().toISOString(),
    });
    this._save();
  }

  addGradeChanges(changes) {
    console.log('[changes] writing count=' + (Array.isArray(changes) ? changes.length : 0));
    if (!Array.isArray(changes) || changes.length === 0) return;
    const now = new Date().toISOString();
    for (const change of changes) {
      this.data.gradeChanges.push({
        ...change,
        createdAt: change.createdAt || now,
        detectedAt: change.detectedAt || now,
      });
    }
    this._save();
  }

  getGradeChanges(limit = 20) {
    return (this.data.gradeChanges || [])
      .slice()
      .sort((a, b) => String(b.createdAt || b.detectedAt || "").localeCompare(String(a.createdAt || a.detectedAt || "")))
      .slice(0, limit);
  }

  // ========== 课表相关 ==========

  getTimetable(termYear, termSemester) {
    this._load();
    this._ensureShape();
    return (this.data.timetable || []).filter(item =>
      String(item.termYear) === String(termYear) &&
      String(item.termSemester) === String(termSemester)
    );
  }

  replaceTimetableForTerm(termYear, termSemester, rows) {
    this._load();
    this._ensureShape();
    const nextRows = Array.isArray(rows) ? rows : [];
    this.data.timetable = (this.data.timetable || []).filter(item =>
      String(item.termYear) !== String(termYear) ||
      String(item.termSemester) !== String(termSemester)
    );
    this.data.timetable.push(...nextRows);
    this.data.timetableLastSyncAt = new Date().toISOString();
    this.data.syncMeta.timetable.lastSuccessfulSyncAt = this.data.timetableLastSyncAt;
    this.data.syncMeta.timetable.lastError = null;
    this.data.syncMeta.timetable.lastErrorMessage = null;
    this._save();
  }

  getSyncMeta(kind) {
    this._load();
    this._ensureShape();
    return this.data.syncMeta[kind] || {};
  }

  setSyncSuccess(kind, at) {
    this._load();
    this._ensureShape();
    const now = at || new Date().toISOString();
    this.data.syncMeta[kind] = {
      ...(this.data.syncMeta[kind] || {}),
      lastSuccessfulSyncAt: now,
      lastError: null,
      lastErrorMessage: null
    };
    this._save();
  }

  setSyncFailure(kind, code, message, at) {
    this._load();
    this._ensureShape();
    this.data.syncMeta[kind] = {
      ...(this.data.syncMeta[kind] || {}),
      lastFailedSyncAt: at || new Date().toISOString(),
      lastError: code || "JWXT_LOGIN_FAILED",
      lastErrorMessage: message || ""
    };
    this._save();
  }

  // 获取所有未通知的变化
  getUnnoticedChanges() {
    return this.data.gradeChanges.filter(c => !c.noticed);
  }

  // 标记变化为已通知
  markChangesNoticed() {
    for (const c of this.data.gradeChanges) {
      c.noticed = true;
    }
    this._save();
  }

  // ========== 评教相关 ==========

  getEvaluationStatus() {
    return this.data.evaluation;
  }

  setEvaluationStatus(status) {
    this.data.evaluation = {
      status,
      lastCheckedAt: new Date().toISOString(),
    };
    this._save();
  }

  // ========== 运行记录 ==========

  updateLastRun() {
    this.data.lastRunAt = new Date().toISOString();
    this._save();
  }
}

function createStorageForUser(userId) {
  return new JsonStorage(getUserPaths(userId).campusPath);
}

const defaultStorage = new JsonStorage();

module.exports = defaultStorage;
module.exports.JsonStorage = JsonStorage;
module.exports.createStorageForUser = createStorageForUser;
