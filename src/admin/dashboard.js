(function(){
  "use strict";
  var adminKey="";
  var polling=false;
  var timers=[];
  var inFlight={summary:false,timeseries:false,errors:false,health:false};
  var lastSuccess=null;
  var labels={wechatLogin:"微信登录次数",gradesQuery:"查看成绩次数",timetableQuery:"查看课表次数",bindAccount:"绑定账号次数",unbindAccount:"解绑账号次数"};
  var problemLabels={wechat_login:"微信登录",grades_query:"查看成绩",timetable_query:"查看课表",bind_account:"绑定账号",unbind_account:"解绑账号"};
  var friendlyErrorReasons={
    ACCOUNT_RELOGIN_REQUIRED:"校园账号需要重新登录",
    CAMPUS_LOGIN_REQUIRED:"需要先登录校园账号",
    COOKIE_EXPIRED:"校园账号登录状态已过期",
    DATA_DELETION_IN_PROGRESS:"账号数据正在删除",
    GRADE_QUERY_UNAVAILABLE:"暂时无法查看成绩",
    INTERNAL_ERROR:"系统内部出现异常",
    INVALID_ACCOUNT:"账号信息填写不完整",
    INVALID_CREDENTIALS:"账号或密码错误",
    INVALID_DATE:"日期信息有误",
    JWXT_CAPTCHA_INVALID:"验证码错误",
    JWXT_CAPTCHA_REQUIRED:"需要验证码后才能继续登录",
    JWXT_CAPTCHA_SESSION_EXPIRED:"验证码已过期，请重新获取",
    JWXT_INVALID_CREDENTIALS:"账号或密码错误",
    JWXT_LOGIN_FAILED:"学校教务系统登录失败",
    JWXT_SSO_FAILED:"学校教务系统登录连接失败",
    JWXT_TIMEOUT:"学校教务系统响应超时",
    JWXT_UNAVAILABLE:"学校教务系统暂时无法访问",
    LOGIN_REQUIRED:"请先绑定教务账号",
    NOT_BOUND:"账号尚未绑定",
    PERSISTENCE_UNAVAILABLE:"暂时无法保存账号信息",
    PORTAL_LOGIN_UNCONFIRMED:"学校教务系统暂时未确认登录",
    PORTAL_UNAVAILABLE:"学校统一登录平台暂时无法访问",
    PORTAL_VERIFICATION_REQUIRED:"学校登录需要进一步验证",
    RATE_LIMITED:"操作过于频繁，请稍后再试",
    REVIEW_DEMO_ACCOUNT_CONFLICT:"当前已绑定其他校园账号",
    REVIEW_DEMO_UNAVAILABLE:"审核体验账号暂时不可用",
    TIMETABLE_CONFIG_FAILED:"课表配置暂时异常",
    TIMETABLE_EMPTY:"暂未获取到课表数据",
    TIMETABLE_TODAY_FAILED:"今日课表获取失败",
    TIMETABLE_WEEK_FAILED:"本周课表获取失败",
    UNAUTHORIZED:"登录状态已失效",
    UNBIND_FAILED:"解绑账号失败",
    UNKNOWN:"暂时无法确定具体原因",
    WECHAT_CONFIG_MISSING:"微信登录配置暂时异常",
    WECHAT_LOGIN_FAILED:"微信登录失败",
    XG_LOGIN_REQUIRED:"学校系统需要重新登录",
    XG_SESSION_MISSING:"学校系统登录状态不存在",
    NETWORK_ERROR:"网络连接异常",
    DATABASE_ERROR:"数据库暂时异常"
  };
  var el=function(id){return document.getElementById(id);};
  function text(id,value){el(id).textContent=String(value);}
  function getFriendlyErrorInfo(errorType){var code=String(errorType||"UNKNOWN").trim().toUpperCase();return{code:code,reason:friendlyErrorReasons[code]||"暂时无法识别的问题"};}
  function countText(value,unit){var number=Number(value);return (Number.isFinite(number)?number:0)+" "+unit;}
  function speedText(value,hasData){var number=Number(value);if(!hasData||!Number.isFinite(number))return"暂无数据";if(number<100)return"很快";if(number<=300)return"正常";if(number<=1000)return"稍慢";return"较慢";}
  function durationText(seconds){var value=Math.max(0,Number(seconds)||0);if(value<3600)return Math.floor(value/60)+" 分钟";if(value<86400)return Math.floor(value/3600)+" 小时";return Math.floor(value/86400)+" 天 "+Math.floor(value%86400/3600)+" 小时";}
  function schedule(fn,delay){timers.push(window.setTimeout(fn,delay));}
  function clearPolling(){polling=false;timers.forEach(window.clearTimeout);timers=[];}
  function unauthorized(){adminKey="";clearPolling();el("dashboard").hidden=true;el("loginPanel").hidden=false;text("loginError","密钥无效或监控面板未启用");el("liveDot").className="dot error";text("lastUpdated","连接已断开");}
  async function loadJson(name,url){
    if(!polling||document.hidden||inFlight[name])return null;
    inFlight[name]=true;
    try{
      var response=await fetch(url,{headers:{"X-Admin-Dashboard-Key":adminKey},cache:"no-store",credentials:"omit"});
      if(response.status===404||response.status===403){unauthorized();return null;}
      if(!response.ok)throw new Error("unavailable");
      var data=await response.json();
      lastSuccess=new Date();el("liveDot").className="dot live";text("lastUpdated","更新于 "+lastSuccess.toLocaleTimeString("zh-CN",{hour12:false}));text("dataNotice","");
      return data;
    }catch(_){el("liveDot").className="dot error";text("dataNotice",lastSuccess?"数据暂时不可用，正在显示最近一次成功结果。":"监控数据暂时不可用，请稍后重试。");return null;}
    finally{inFlight[name]=false;}
  }
  function loop(name,url,interval,render){
    async function tick(){var data=await loadJson(name,url);if(data)render(data);if(polling)schedule(tick,interval);}
    tick();
  }
  function renderEventGrid(gridId,eventData,useProvidedRate){
    var grid=el(gridId);grid.replaceChildren();Object.keys(labels).forEach(function(key){var item=eventData&&eventData[key]||{total:0,success:0,failure:0,successRate:0};var rate=useProvidedRate&&Number.isFinite(Number(item.successRate))?Number(item.successRate):(item.total?Math.round(item.success/item.total*1000)/10:0);var box=document.createElement("div");box.className="event";var name=document.createElement("span");name.textContent=labels[key];var total=document.createElement("strong");total.textContent="总次数 "+item.total;var split=document.createElement("small");var good=document.createElement("b");good.textContent="成功 "+item.success;var bad=document.createElement("em");bad.textContent="失败 "+item.failure;split.append(good,document.createTextNode(" · "),bad,document.createTextNode(" · 成功率 "+rate+"%"));box.append(name,total,split);if(Number(item.total)===0){var empty=document.createElement("small");empty.className="event-empty";empty.textContent=useProvidedRate?"还没有记录到这个功能的使用":"今天暂时还没有人使用这个功能";box.append(empty);}grid.append(box);});
  }
  function renderSummary(data){
    var todayHasRequests=Number(data.today.requestCount)>0;text("uniqueUsers",countText(data.today.uniqueUsers,"人"));text("activeUsers",countText(data.today.activeUsers5m,"人"));text("activeUsersHelp",Number(data.today.activeUsers5m)===0?"最近5分钟暂时没人操作":"最近5分钟内产生操作的用户");text("requestCount",countText(data.today.requestCount,"次"));text("averageMs",countText(data.today.averageResponseTimeMs,"毫秒"));text("p95Ms",countText(data.today.p95ResponseTimeMs,"毫秒"));text("averageSpeed",speedText(data.today.averageResponseTimeMs,todayHasRequests));text("p95Speed",speedText(data.today.p95ResponseTimeMs,todayHasRequests));
    renderEventGrid("eventGrid",data.events,false);var lifetime=data.lifetime||{registeredUsers:0,requestCount:0,averageResponseTimeMs:0,p95ResponseTimeMs:0,monitoringStartedAt:null,events:{}};var lifetimeHasRequests=Number(lifetime.requestCount)>0;text("registeredUsers",countText(lifetime.registeredUsers,"人"));text("lifetimeRequestCount",countText(lifetime.requestCount,"次"));text("lifetimeAverageMs",countText(lifetime.averageResponseTimeMs,"毫秒"));text("lifetimeP95Ms",countText(lifetime.p95ResponseTimeMs,"毫秒"));text("lifetimeAverageSpeed",speedText(lifetime.averageResponseTimeMs,lifetimeHasRequests));text("lifetimeP95Speed",speedText(lifetime.p95ResponseTimeMs,lifetimeHasRequests));renderEventGrid("lifetimeEventGrid",lifetime.events,true);if(lifetime.monitoringStartedAt){var startedAt=new Date(lifetime.monitoringStartedAt);var generatedAt=new Date(data.generatedAt);var days=Math.max(1,Math.ceil((generatedAt.getTime()-startedAt.getTime())/86400000));text("monitoringDays",countText(days,"天"));text("monitoringStart","数据开始记录时间："+startedAt.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}));}else{text("monitoringDays","0 天");text("monitoringStart","数据开始记录时间：尚无数据");}
  }
  function renderChart(data){
    var svg=el("requestChart");svg.replaceChildren();var points=data.points||[];var max=Math.max.apply(null,points.map(function(p){return Number(p.requestCount)||0;}));el("chartEmpty").hidden=max>0;if(!points.length)return;
    var width=800,height=260,pad=28;for(var i=0;i<4;i++){var line=document.createElementNS("http://www.w3.org/2000/svg","line");var y=pad+i*(height-pad*2)/3;line.setAttribute("x1",pad);line.setAttribute("x2",width-pad);line.setAttribute("y1",y);line.setAttribute("y2",y);line.setAttribute("class","grid-line");svg.append(line);}[[pad-4,pad+4,String(max),"end"],[pad-4,height-pad+4,"0","end"],[pad,height-7,new Date(points[0].timestamp).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),"start"],[width-pad,height-7,new Date(points[points.length-1].timestamp).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),"end"]].forEach(function(item){var label=document.createElementNS("http://www.w3.org/2000/svg","text");label.setAttribute("x",item[0]);label.setAttribute("y",item[1]);label.setAttribute("text-anchor",item[3]);label.setAttribute("class","chart-label");label.textContent=item[2];svg.append(label);});
    var coords=points.map(function(p,index){return [pad+index*(width-pad*2)/Math.max(1,points.length-1),height-pad-(Number(p.requestCount)||0)*(height-pad*2)/Math.max(1,max)];});var path=coords.map(function(p,index){return(index?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1);}).join(" ");var area=document.createElementNS("http://www.w3.org/2000/svg","path");area.setAttribute("d",path+" L "+(width-pad)+" "+(height-pad)+" L "+pad+" "+(height-pad)+" Z");area.setAttribute("class","chart-area");var stroke=document.createElementNS("http://www.w3.org/2000/svg","path");stroke.setAttribute("d",path);stroke.setAttribute("class","chart-line");svg.append(area,stroke);
  }
  function renderErrors(data){var body=el("errorRows");body.replaceChildren();var rows=data.errors||[];el("errorsEmpty").hidden=rows.length>0;text("errorsTitle",rows.length?"最近发现的问题":"最近24小时出现的问题");rows.forEach(function(item){var info=getFriendlyErrorInfo(item.errorType);var tr=document.createElement("tr");var feature=document.createElement("td");feature.textContent=problemLabels[item.eventType]||"其他功能";var problem=document.createElement("td");var problemName=document.createElement("span");problemName.textContent=info.reason;var problemCode=document.createElement("small");problemCode.className="problem-code";problemCode.textContent="问题代码："+info.code;problem.append(problemName,problemCode);var count=document.createElement("td");count.textContent=countText(item.count,"次");var occurred=document.createElement("td");occurred.textContent=new Date(item.lastOccurredAt).toLocaleString("zh-CN",{hour12:false});tr.append(feature,problem,count,occurred);body.append(tr);});}
  function healthLabel(value){if(value==="ok")return"正常";if(value==="error")return"异常";return"暂时无法确认";}
  function renderHealth(data){var serviceState=data.service&&data.service.status;var serviceOk=serviceState==="ok";text("expressStatus",healthLabel(serviceState));el("expressStatus").className=serviceOk?"ok":serviceState==="error"?"bad":"";text("serviceUptime",data.service?durationText(data.service.uptimeSeconds):"暂时无法确认");var databaseState=data.postgres&&data.postgres.status;var databaseOk=databaseState==="ok";text("postgresStatus",healthLabel(databaseState));el("postgresStatus").className=databaseOk?"ok":databaseState==="error"?"bad":"";text("postgresLatency",data.postgres?countText(data.postgres.latencyMs,"毫秒")+" · "+speedText(data.postgres.latencyMs,true):"暂时无法确认");}
  function startPolling(){clearPolling();polling=true;loop("summary","/admin/metrics/summary",5000,renderSummary);loop("health","/admin/health",5000,renderHealth);loop("timeseries","/admin/metrics/timeseries?range=60m&bucket=minute",15000,renderChart);loop("errors","/admin/metrics/errors?limit=20",15000,renderErrors);}
  el("loginForm").addEventListener("submit",function(event){event.preventDefault();adminKey=el("adminKey").value;el("adminKey").value="";text("loginError","");el("loginPanel").hidden=true;el("dashboard").hidden=false;startPolling();});
  document.addEventListener("visibilitychange",function(){if(document.hidden){timers.forEach(window.clearTimeout);timers=[];}else if(adminKey){startPolling();}});
})();
