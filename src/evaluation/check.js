const config = require('../config');

/**
 * 教学评价状态检测模块
 */
class EvaluationChecker {
  constructor(axiosClient) {
    this.client = axiosClient;
  }

  /**
   * 检查教学评价是否已完成
   * @returns {Promise<string>} 'completed' | 'pending' | 'unknown'
   */
  async check() {
    const url = config.urls.jwxt.base + config.urls.jwxt.evaluationMain;

    console.log('[评教] 检查教学评价状态...');

    try {
      const response = await this.client.get(url, {
        headers: {
          'Referer': config.urls.jwxt.base + '/xtgl/index_initMenu.html?jsdm=xs',
        },
      });

      const html = response.data;

      // 判断是否已完成评教
      // 常见判断方式：
      // 1. 页面中包含"评教已完成"或类似文字
      // 2. 页面重定向到评教列表
      // 3. 页面返回空数据

      if (typeof html !== 'string') {
        console.log('[评教] 响应不是HTML，无法判断');
        return 'unknown';
      }

      // 检查是否提示已完成
      if (html.includes('已完成') || html.includes('已评教') ||
          html.includes('评价完成') || html.includes('已经评价')) {
        console.log('[评教] ✅ 教学评价已完成');
        return 'completed';
      }

      // 检查是否需要评教（有未评教的课程）
      if (html.includes('未评教') || html.includes('待评价') ||
          html.includes('评价') || html.includes('问卷') ||
          html.includes('评教')) {
        console.log('[评教] ⚠️ 有待完成的教学评价');
        return 'pending';
      }

      // 如果页面内容较少，可能是没有开放评教
      if (html.length < 200) {
        console.log('[评教] 页面内容较少，评教可能未开放');
        return 'unknown';
      }

      console.log('[评教] 无法确定评教状态（页面包含内容）');
      return 'unknown';

    } catch (err) {
      console.error('[评教] ❌ 检测失败:', err.message);
      return 'unknown';
    }
  }
}

module.exports = EvaluationChecker;
