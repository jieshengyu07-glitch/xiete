/**
 * 控制台通知模块
 */
class ConsoleNotifier {
  /**
   * 发送通知（控制台输出）
   */
  async send(title, message, type = 'info') {
    const prefix = {
      'info': '🔔',
      'success': '✅',
      'warning': '⚠️',
      'error': '❌',
      'grade': '📚',
    }[type] || '🔔';

    console.log('');
    console.log(`${prefix} ${'='.repeat(50)}`);
    console.log(`${prefix} ${title}`);
    console.log(`${prefix} ${'='.repeat(50)}`);
    console.log(message);
    console.log(`${prefix} ${'='.repeat(50)}`);
    console.log('');
  }

  /**
   * 通知新成绩
   */
  async notifyNewGrades(grades) {
    if (grades.length === 0) return;
    const title = `发现 ${grades.length} 门新课程成绩！`;
    const message = grades.map(g =>
      `  📖 ${g.kcmc} | 成绩: ${g.cj} | 学分: ${g.xf} | ${g.xnm} 第${g.xqm}学期`
    ).join('\n');
    await this.send(title, message, 'grade');
  }

  /**
   * 通知成绩变更
   */
  async notifyGradeChanges(changes) {
    if (changes.length === 0) return;
    const title = `${changes.length} 门课程成绩有变更！`;
    const message = changes.map(c =>
      `  📖 ${c.course}: ${c.old} → ${c.new}`
    ).join('\n');
    await this.send(title, message, 'warning');
  }

  /**
   * 通知评教提醒
   */
  async notifyEvaluationPending() {
    await this.send(
      '教学评价提醒',
      '  你还有未完成的教学评价！\n  请尽快完成评教以查看成绩。',
      'warning'
    );
  }

  /**
   * 通知评教已完成
   */
  async notifyEvaluationCompleted() {
    await this.send(
      '教学评价状态',
      '  教学评价已完成 ✅',
      'success'
    );
  }

  /**
   * 通知运行摘要
   */
  async notifySummary(gradeCount, newCount, changedCount) {
    await this.send(
      '运行摘要',
      `  已出成绩: ${gradeCount} 门\n  新增: ${newCount} 门\n  变更: ${changedCount} 门`,
      'info'
    );
  }

  /**
   * 通知启动
   */
  async notifyStart() {
    await this.send('校园助手已启动', '  正在监控成绩发布...\n  每30分钟自动检查一次', 'info');
  }

  /**
   * 通知错误
   */
  async notifyError(err) {
    await this.send('运行出错', `  错误信息: ${err.message}`, 'error');
  }
}

module.exports = new ConsoleNotifier();
