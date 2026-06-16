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
3. Build: npm install
4. Start: npm start
5. POST /upload-cookies 上传 cookies
6. 访问 /status 验证

## 环境变量

PORT: 端口 (default 3456)
COOKIES_JSON: cookies JSON 字符串