# Campus Grade Monitor API

学生成绩监控 API 服务。定时从教务系统查询成绩，检测变化并通过 HTTP API 输出。

## 技术栈

- 运行时: Node.js
- 框架: Express
- 定时任务: node-cron
- 数据存储: JSON 文件 (data/)

## 本地开发

npm install
npm start
npm run login

## API 端点

GET /status -> 系统状态
GET /grades -> 所有成绩
POST /check -> 手动检查
POST /upload-cookies -> 上传 cookies

## 部署到 Render

1. git push
2. Render New Web Service
3. Build: npm ci --omit=dev
4. Start: npm start
5. 配置生产环境变量与 Persistent Disk
6. 访问 /health 验证

## 环境变量

- `PORT`: 端口（默认 3456）
- `DATA_DIR`: 持久化数据目录，Render 使用 `/data`
- `JWT_SECRET`: 不少于 32 字符的 JWT 密钥
- `CREDENTIAL_SECRET`: 不少于 32 字符且与 JWT 独立的凭据加密密钥
- `WECHAT_APPID`: 微信小程序 AppID
- `WECHAT_SECRET`: 微信小程序 Secret

生产环境禁止使用 `COOKIES_JSON`、`JWXT_STUDENT_ID` 和 `JWXT_PASSWORD`。

## 微信审核演示账号

审核演示模式默认关闭。需要提审时，在 Render 配置：

- `REVIEW_DEMO_ENABLED=true`
- `REVIEW_DEMO_USERNAME`: 审核专用账号，不得与真实学号相同
- `REVIEW_DEMO_PASSWORD`: 至少 16 字符的随机密码

审核账号绑定后只读取内置脱敏样例，不访问 JWXT、XG、Cookie 或真实用户缓存。审核结束后将
`REVIEW_DEMO_ENABLED` 改为 `false` 并重新部署即可关闭入口。
