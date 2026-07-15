const path = require('path');

const fs = require('fs');

function resolveDataDir() {
  const configured = String(process.env.DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === 'development') {
    return path.resolve(__dirname, '..', 'data');
  }
  const err = new Error('DATA_DIR is required outside NODE_ENV=development');
  err.code = 'DATA_DIR_REQUIRED';
  throw err;
}

let dataPathLogged = false;

const PRODUCTION_LEGACY_CREDENTIAL_ENV_NAMES = [
  'COOKIES_JSON',
  'JWXT_STUDENT_ID',
  'JWXT_PASSWORD'
];

function assertProductionEnvSafety() {
  if (process.env.NODE_ENV !== 'production') return;

  const configured = PRODUCTION_LEGACY_CREDENTIAL_ENV_NAMES.filter(name =>
    String(process.env[name] || '').trim()
  );
  if (!configured.length) return;

  console.warn(
    '[security] production legacy credential environment variables are forbidden: ' +
    configured.join(',')
  );
  const err = new Error('PRODUCTION_LEGACY_CREDENTIALS_FORBIDDEN');
  err.code = 'PRODUCTION_LEGACY_CREDENTIALS_FORBIDDEN';
  throw err;
}

function assertDataDirWritable() {
  const dir = config.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, '.write-probe-' + process.pid + '-' + Date.now());
  try {
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
  } catch (cause) {
    try {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    } catch (cleanupErr) {}
    const err = new Error('DATA_DIR is not writable: ' + dir);
    err.code = 'DATA_DIR_NOT_WRITABLE';
    err.cause = cause;
    throw err;
  }
}

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
  dataDir: resolveDataDir(),
};

function logDataPath() {
  if (dataPathLogged) return;
  dataPathLogged = true;
  console.log('[data] storage path=' + config.dataDir);
}

config.logDataPath = logDataPath;
config.resolveDataDir = resolveDataDir;
config.assertProductionEnvSafety = assertProductionEnvSafety;
config.assertDataDirWritable = assertDataDirWritable;

module.exports = config;
