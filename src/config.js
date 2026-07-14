const path = require('path');

// ============ 用户配置 ============
// 通过环境变量提供教务账号，避免在代码中保存明文账号密码。
const config = {
  username: process.env.JWXT_STUDENT_ID || '',
  password: process.env.JWXT_PASSWORD || '',

  // ============ 系统 URL 配置（无需修改） ============
  urls: {
    // CAS 统一认证
    cas: {
      loginPage: 'https://sso1.tyust.edu.cn/login?service=https%3A%2F%2Fsso1.tyust.edu.cn%2Foauth2.0%2FcallbackAuthorize%3Fclient_id%3Drhmh%26redirect_uri%3Dhttps%253A%252F%252Fronghemenhu.tyust.edu.cn%252Fsso%252Flogin%26response_type%3Dcode%26client_name%3DCasOAuthClient',
    },
    // 正方教务系统
    jwxt: {
      base: 'https://newjwc.tyust.edu.cn/jwglxt',
      gradeQuery: '/cjcx/cjcx_cxXsgrcj.html?doType=query',
      evaluationMain: '/jxpg/xsMain.html',
    },
  },

  // ============ 轮询配置 ============
  pollInterval: '*/30 * * * *', // 每30分钟执行一次（cron 表达式）

  // ============ 数据存储路径 ============
  dataDir: path.join(__dirname, '..', 'data'),
};

module.exports = config;
