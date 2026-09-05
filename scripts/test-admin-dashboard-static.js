const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { createAdminRouter } = require("../src/admin/routes");

const SECRET = "dashboard-test-secret-0123456789-abcdef";
function get(server, pathname) { return new Promise((resolve, reject) => { http.get({ hostname: "127.0.0.1", port: server.address().port, path: pathname }, res => { let body=""; res.on("data", c => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); }).on("error", reject); }); }
async function serve(environment, run) { const app=express(); app.use("/admin",createAdminRouter({ environment, service:{ summary(){},timeseries(){},errors(){},health(){} } })); const server=await new Promise(resolve=>{const value=app.listen(0,"127.0.0.1",()=>resolve(value));}); try{await run(server);}finally{await new Promise(resolve=>server.close(resolve));} }

async function main(){
  await serve({},async server=>{assert.strictEqual((await get(server,"/admin/dashboard")).status,404);});
  await serve({ADMIN_DASHBOARD_SECRET:SECRET},async server=>{const page=await get(server,"/admin/dashboard");assert.strictEqual(page.status,200);assert.match(page.body,/太小科校园助手 · 实时监控/);assert.strictEqual(page.headers["cache-control"],"no-store");assert.strictEqual(page.headers.pragma,"no-cache");assert.strictEqual(page.headers["x-content-type-options"],"nosniff");assert.strictEqual(page.headers["x-frame-options"],"DENY");assert.strictEqual(page.headers["referrer-policy"],"no-referrer");assert.match(page.headers["content-security-policy"],/script-src 'self'/);assert.match(page.body,/type="password"/);assert.strictEqual((await get(server,"/admin/dashboard.js")).status,200);});
  const js=fs.readFileSync(path.join(__dirname,"..","src","admin","dashboard.js"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"..","src","admin","dashboard.html"),"utf8");
  ["localStorage","sessionStorage","indexedDB","document.cookie","location.hash","location.search","console."].forEach(value=>assert.ok(!js.includes(value),value+" must not be used"));
  assert.match(js,/5000/);assert.match(js,/15000/);assert.match(js,/visibilitychange/);assert.match(js,/inFlight/);assert.ok(!js.includes(SECRET));
  ["今日实时","累计总览","今日业务事件","累计业务事件"].forEach(value=>assert.ok(html.includes(value)));
  assert.strictEqual((js.match(/"\/admin\/metrics\/summary"/g)||[]).length,1);
  assert.ok(!/lifetimeUniqueUsers|stableUserHash|openidHash/.test(js+html));
  assert.match(html,/<th>问题原因<\/th>/);
  assert.match(js,/function getFriendlyErrorInfo\(errorType\)/);
  [
    ["INVALID_CREDENTIALS","账号或密码错误"],
    ["PORTAL_LOGIN_UNCONFIRMED","学校教务系统暂时未确认登录"],
    ["UNKNOWN","暂时无法确定具体原因"]
  ].forEach(([code,label])=>assert.ok(js.includes(code+':"'+label+'"'),code+" must have a friendly label"));
  assert.match(js,/friendlyErrorReasons\[code\]\|\|"暂时无法识别的问题"/);
  assert.match(js,/problemCode\.textContent="问题代码："\+info\.code/);
  const mappingDeclaration=js.match(/var friendlyErrorReasons=\{[\s\S]*?\};/)[0];
  const mappingFunction=js.match(/function getFriendlyErrorInfo\(errorType\)\{[^\n]+\}/)[0];
  const friendlyError=Function(mappingDeclaration+mappingFunction+";return getFriendlyErrorInfo;")();
  assert.deepStrictEqual(friendlyError("INVALID_CREDENTIALS"),{code:"INVALID_CREDENTIALS",reason:"账号或密码错误"});
  assert.deepStrictEqual(friendlyError("PORTAL_LOGIN_UNCONFIRMED"),{code:"PORTAL_LOGIN_UNCONFIRMED",reason:"学校教务系统暂时未确认登录"});
  assert.deepStrictEqual(friendlyError("UNKNOWN"),{code:"UNKNOWN",reason:"暂时无法确定具体原因"});
  assert.deepStrictEqual(friendlyError("FUTURE_SAFE_CODE"),{code:"FUTURE_SAFE_CODE",reason:"暂时无法识别的问题"});
  const renderErrors=js.slice(js.indexOf("function renderErrors"),js.indexOf("function healthLabel"));
  ["item.message","item.stack","item.response","item.data","openid","studentId","userDayHash"].forEach(value=>assert.ok(!renderErrors.includes(value),value+" must not be rendered"));
  console.log("adminDashboardStaticSecurityHeadersTest=passed");
  console.log("adminDashboardFriendlyErrorMappingTest=passed");
  console.log("adminDashboardMemoryOnlySecretAndPollingTest=passed");
}
main().catch(err=>{console.error(err);process.exitCode=1;});
