const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getUserPaths } = require('../services/userPaths');

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
      console.error('[存储] 读取数据文件失败，使用默认数据:', err.message);
      this.data = this._getDefaultData();
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[存储] 保存数据文件失败:', err.message);
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
      lastRunAt: null,    // 上次运行时间
    };
  }

  _ensureShape() {
    if (!this.data) this.data = this._getDefaultData();
    if (!Array.isArray(this.data.grades)) this.data.grades = [];
    if (!Array.isArray(this.data.gradeChanges)) this.data.gradeChanges = [];
    if (!Array.isArray(this.data.timetable)) this.data.timetable = [];
  }

  _value(grade, lower, upper) {
    if (!grade) return '';
    return grade[lower] !== undefined && grade[lower] !== null ? grade[lower] :
      (grade[upper] !== undefined && grade[upper] !== null ? grade[upper] : '');
  }

  _gradeKey(grade) {
    const kcmc = String(this._value(grade, 'kcmc', 'KCMC'));
    const kch = String(this._value(grade, 'kch', 'KCH'));
    const xnm = String(this._value(grade, 'xnm', 'XNM'));
    const xqm = String(this._value(grade, 'xqm', 'XQM'));
    return [kcmc, kch, xnm, xqm].join('|');
  }

  _score(grade) {
    return String(this._value(grade, 'cj', 'CJ'));
  }

  _courseName(grade) {
    return this._value(grade, 'kcmc', 'KCMC');
  }

  _xnm(grade) {
    return this._value(grade, 'xnm', 'XNM');
  }

  _xqm(grade) {
    return this._value(grade, 'xqm', 'XQM');
  }

  // ========== 成绩相关 ==========

  // 获取所有已存储的成绩
  getGrades() {
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
    const existing = this.data.grades;
    const added = [];
    const changed = [];

    console.log('[diff] oldGrades=' + existing.length);
    console.log('[diff] newGrades=' + (Array.isArray(newGrades) ? newGrades.length : 0));

    for (const ng of newGrades) {
      const newKey = this._gradeKey(ng);
      const old = existing.find(e => this._gradeKey(e) === newKey);
      if (!old) {
        added.push(ng);
      } else if (this._score(old) !== this._score(ng)) {
        changed.push({
          old: this._score(old),
          new: this._score(ng),
          course: this._courseName(ng),
          oldGrade: old,
          newGrade: ng,
          oldCj: this._score(old),
          newCj: this._score(ng),
          kcmc: this._courseName(ng),
          xnm: this._xnm(ng),
          xqm: this._xqm(ng)
        });
      }
    }

    console.log('[diff] added=' + added.length);
    console.log('[diff] changed=' + changed.length);
    return { added, changed };
  }

  // 合并新成绩到存储
  mergeGrades(newGrades) {
    this._ensureShape();
    for (const ng of newGrades) {
      const newKey = this._gradeKey(ng);
      const idx = this.data.grades.findIndex(e => this._gradeKey(e) === newKey);
      if (idx === -1) {
        this.data.grades.push(ng);
      } else {
        // 更新已有记录
        if (this._score(this.data.grades[idx]) !== this._score(ng)) {
          this.data.grades[idx] = {
            ...this.data.grades[idx],
            ...ng,
            cjBj: '(已更新)'
          };
        } else {
          this.data.grades[idx] = {
            ...this.data.grades[idx],
            ...ng
          };
        }
      }
    }
    this._save();
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
