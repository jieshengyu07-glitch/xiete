const fs = require('fs');
const path = require('path');
const config = require('../config');

class JsonStorage {
  constructor() {
    this.dataDir = config.dataDir;
    this.filePath = path.join(this.dataDir, 'campus.json');
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
      evaluation: {       // 评教状态
        status: 'unknown', // unknown | pending | completed
        lastCheckedAt: null,
      },
      lastRunAt: null,    // 上次运行时间
    };
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
    const existing = this.data.grades;
    const added = [];
    const changed = [];

    for (const ng of newGrades) {
      const old = existing.find(e =>
        e.kch === ng.kch && e.xnm === ng.xnm && e.xqm === ng.xqm
      );
      if (!old) {
        added.push(ng);
      } else if (old.cj !== ng.cj) {
        changed.push({ old: old.cj, new: ng.cj, course: ng.kcmc });
      }
    }

    return { added, changed };
  }

  // 合并新成绩到存储
  mergeGrades(newGrades) {
    for (const ng of newGrades) {
      const idx = this.data.grades.findIndex(e =>
        e.kch === ng.kch && e.xnm === ng.xnm && e.xqm === ng.xqm
      );
      if (idx === -1) {
        this.data.grades.push(ng);
      } else {
        // 更新已有记录
        if (this.data.grades[idx].cj !== ng.cj) {
          this.data.grades[idx].cj = ng.cj;
          this.data.grades[idx].cjBj = '(已更新)';
        }
      }
    }
    this._save();
  }

  // 记录成绩变化
  addGradeChange(change) {
    this.data.gradeChanges.push({
      ...change,
      detectedAt: new Date().toISOString(),
    });
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

module.exports = new JsonStorage();
