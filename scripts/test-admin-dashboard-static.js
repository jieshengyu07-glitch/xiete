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
  assert.ok(html.includes("当前已绑定账号"));
  assert.ok(html.includes("绑定率"));
  assert.match(html,/id="boundUsers"/);
  assert.match(html,/id="bindingRate"/);
  assert.match(js,/text\("boundUsers",countText\(lifetime\.boundUsers,"人"\)\)/);
  assert.match(js,/text\("bindingRate",percentText\(lifetime\.bindingRate\)\)/);
  const percentFunction=Function(js.match(/function percentText\(value\)\{[^\n]+\}/)[0]+";return percentText;")();
  assert.strictEqual(percentFunction(80),"80.0%");
  assert.strictEqual(percentFunction(0),"0.0%");
  ["绑定流程情况","开始绑定","学校登录成功","账号保存成功","进入教务系统成功","今天为什么绑定失败","影响人数是今天的匿名去重人数"].forEach(value=>assert.ok(html.includes(value)));
  assert.match(js,/renderBindingFunnel\(data\.bindingFunnel\)/);
  assert.match(js,/renderBindingFailures\(data\.bindingFailures\)/);
  assert.ok(!/bindingFailureList[^\n]+errorType/.test(js));
  assert.match(html,/<th>功能<\/th><th>发生了什么<\/th><th>次数<\/th><th>最近一次<\/th>/);
  assert.match(js,/function getFriendlyErrorInfo\(errorType\)/);
  [
    ["INVALID_CREDENTIALS","账号或密码错误"],
    ["PORTAL_LOGIN_UNCONFIRMED","学校系统登录失败"],
    ["UNKNOWN","暂时无法确定原因"]
  ].forEach(([code,label])=>assert.ok(js.includes(code+':"'+label+'"'),code+" must have a friendly label"));
  assert.match(js,/friendlyErrorReasons\[code\]\|\|"暂时无法识别的问题"/);
  assert.ok(!js.includes("操作未成功"));
  assert.ok(!js.includes("问题代码："));
  assert.match(js,/problem\.title=info\.code/);
  const mappingDeclaration=js.match(/var friendlyErrorReasons=\{[\s\S]*?\};/)[0];
  const mappingFunction=js.match(/function getFriendlyErrorInfo\(errorType\)\{[^\n]+\}/)[0];
  const categoryDeclaration=js.match(/var friendlyErrorCategories=\{[\s\S]*?\};/)[0];
  const friendlyError=Function(mappingDeclaration+categoryDeclaration+mappingFunction+";return getFriendlyErrorInfo;")();
  [
    ["INVALID_CREDENTIALS","账号或密码错误","用户填写的账号或密码不正确"],
    ["JWXT_INVALID_CREDENTIALS","账号或密码错误","用户填写的账号或密码不正确"],
    ["PORTAL_LOGIN_UNCONFIRMED","学校系统登录失败","可能是学校教务系统暂时异常"],
    ["JWXT_CAPTCHA_REQUIRED","需要完成验证码","用户需要继续完成验证"],
    ["JWXT_UNAVAILABLE","学校系统暂时无法访问","可能是学校教务系统暂时异常"],
    ["JWXT_TIMEOUT","学校系统响应太慢","可能是学校教务系统暂时繁忙"],
    ["NETWORK_ERROR","网络连接异常","网络问题"],
    ["DATABASE_ERROR","数据库出现异常","需要关注"],
    ["UNAUTHORIZED","登录状态已失效","用户需要重新登录"],
    ["NOT_BOUND","账号还没有绑定","用户需要先绑定账号"],
    ["INTERNAL_ERROR","小程序后台出现异常","需要关注"],
    ["UNKNOWN","暂时无法确定原因","暂时无法判断"]
  ].forEach(([code,reason,category])=>assert.deepStrictEqual(friendlyError(code),{code,reason,category}));
  assert.deepStrictEqual(friendlyError("FUTURE_SAFE_CODE"),{code:"FUTURE_SAFE_CODE",reason:"暂时无法识别的问题",category:"暂时无法判断"});
  const renderErrors=js.slice(js.indexOf("function renderErrors"),js.indexOf("function healthLabel"));
  assert.ok(!/textContent="问题代码："/.test(renderErrors),"technical code must not be visible body text");
  ["item.message","item.stack","item.response","item.data","openid","studentId","userDayHash"].forEach(value=>assert.ok(!renderErrors.includes(value),value+" must not be rendered"));
  class FakeElement {
    constructor(){this.children=[];this.hidden=false;this.title="";this.className="";this.value="";this._text="";}
    set textContent(value){this._text=String(value);this.children=[];}
    get textContent(){return this._text+this.children.map(child=>typeof child==="string"?child:child.textContent).join("");}
    replaceChildren(...children){this._text="";this.children=children;}
    append(...children){this.children.push(...children);}
  }
  const elements={
    errorRows:new FakeElement(),errorsEmpty:new FakeElement(),errorsTitle:new FakeElement(),
    bindStarted:new FakeElement(),bindPortalConfirmed:new FakeElement(),bindSaved:new FakeElement(),bindJwxtConfirmed:new FakeElement(),
    bindPortalRate:new FakeElement(),bindSavedRate:new FakeElement(),bindJwxtRate:new FakeElement(),bindFinalRate:new FakeElement(),
    bindingFailureList:new FakeElement()
  };
  const fakeDocument={getElementById:id=>elements[id],createElement:()=>new FakeElement()};
  const problemLabelsDeclaration=js.match(/var problemLabels=\{[^\n]+\};/)[0];
  const elDeclaration=js.match(/var el=function\(id\)\{[^\n]+\};/)[0];
  const textFunction=js.match(/function text\(id,value\)\{[^\n]+\}/)[0];
  const countFunction=js.match(/function countText\(value,unit\)\{[^\n]+\}/)[0];
  const renderFunction=js.match(/function renderErrors\(data\)\{[^\n]+\}/)[0];
  const renderDashboardErrors=Function("document",problemLabelsDeclaration+mappingDeclaration+categoryDeclaration+elDeclaration+textFunction+mappingFunction+countFunction+renderFunction+";return renderErrors;")(fakeDocument);
  renderDashboardErrors({errors:[
    {eventType:"bind_account",errorType:"INVALID_CREDENTIALS",count:3,lastOccurredAt:"2026-09-05T00:15:00Z"},
    {eventType:"bind_account",errorType:"PORTAL_LOGIN_UNCONFIRMED",count:2,lastOccurredAt:"2026-09-05T00:16:00Z"}
  ]});
  const visibleErrorText=elements.errorRows.textContent;
  assert.ok(!visibleErrorText.includes("问题代码："));
  assert.ok(!visibleErrorText.includes("INVALID_CREDENTIALS"));
  assert.ok(!visibleErrorText.includes("PORTAL_LOGIN_UNCONFIRMED"));
  assert.ok(visibleErrorText.includes("账号或密码错误"));
  assert.ok(visibleErrorText.includes("用户填写的账号或密码不正确"));
  assert.ok(visibleErrorText.includes("学校系统登录失败"));
  assert.ok(visibleErrorText.includes("可能是学校教务系统暂时异常"));
  assert.strictEqual(elements.errorRows.children[0].children[1].title,"INVALID_CREDENTIALS");
  assert.strictEqual(elements.errorRows.children[1].children[1].title,"PORTAL_LOGIN_UNCONFIRMED");
  const funnelFunction=js.match(/function renderBindingFunnel\(value\)\{[^\n]+\}/)[0];
  const failureFunction=js.match(/function renderBindingFailures\(rows\)\{[^\n]+\}/)[0];
  const percentSource=js.match(/function percentText\(value\)\{[^\n]+\}/)[0];
  const bindingRenderers=Function("document",elDeclaration+textFunction+countFunction+percentSource+funnelFunction+failureFunction+";return {renderBindingFunnel,renderBindingFailures};")(fakeDocument);
  bindingRenderers.renderBindingFunnel({started:25,portalConfirmed:18,saved:8,jwxtConfirmed:5,conversionRates:{portalFromStarted:72,savedFromPortal:44.4,jwxtFromSaved:62.5,finalSuccess:20}});
  bindingRenderers.renderBindingFailures([{reason:"账号或密码错误",failureCount:12,affectedUsers:7}]);
  assert.strictEqual(elements.bindStarted.textContent,"25 次");
  assert.strictEqual(elements.bindPortalRate.textContent,"上一步转化率 72.0%");
  assert.strictEqual(elements.bindFinalRate.textContent,"20.0%");
  assert.strictEqual(elements.bindingFailureList.textContent,"账号或密码错误12 次 · 影响 7 人");
  console.log("adminDashboardStaticSecurityHeadersTest=passed");
  console.log("adminDashboardFriendlyErrorMappingTest=passed");
  console.log("adminDashboardMemoryOnlySecretAndPollingTest=passed");
}
main().catch(err=>{console.error(err);process.exitCode=1;});
