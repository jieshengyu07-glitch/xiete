const cron = require('node-cron');
const config = require('../config');

/**
 * 定时任务调度模块
 */
class Scheduler {
  constructor(taskFn) {
    this.taskFn = taskFn;
    this.task = null;
  }

  /**
   * 启动定时任务
   */
  start() {
    const interval = config.pollInterval;
    console.log(`[调度] 启动定时任务 (${interval})`);

    // 立即执行一次
    this._runTask();

    // 按 cron 表达式定时执行
    this.task = cron.schedule(interval, () => {
      this._runTask();
    });
  }

  /**
   * 执行任务
   */
  async _runTask() {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[调度] 开始执行任务 - ${now}`);
    console.log(`${'='.repeat(60)}`);

    try {
      await this.taskFn();
    } catch (err) {
      console.error('[调度] 任务执行出错:', err.message);
    }

    console.log(`[调度] 任务执行完毕\n`);
  }

  /**
   * 停止定时任务
   */
  stop() {
    if (this.task) {
      this.task.stop();
      console.log('[调度] 定时任务已停止');
    }
  }
}

module.exports = Scheduler;
