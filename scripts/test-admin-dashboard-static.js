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
  ["localStorage","sessionStorage","indexedDB","document.cookie","location.hash","location.search","console."].forEach(value=>assert.ok(!js.includes(value),value+" must not be used"));
  assert.match(js,/5000/);assert.match(js,/15000/);assert.match(js,/visibilitychange/);assert.match(js,/inFlight/);assert.ok(!js.includes(SECRET));
  console.log("adminDashboardStaticSecurityHeadersTest=passed");
  console.log("adminDashboardMemoryOnlySecretAndPollingTest=passed");
}
main().catch(err=>{console.error(err);process.exitCode=1;});
