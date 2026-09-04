(function(){
  "use strict";
  var adminKey="";
  var polling=false;
  var timers=[];
  var inFlight={summary:false,timeseries:false,errors:false,health:false};
  var lastSuccess=null;
  var labels={wechatLogin:"微信登录",gradesQuery:"成绩查询",timetableQuery:"课表查询",bindAccount:"绑定账号",unbindAccount:"解绑账号"};
  var el=function(id){return document.getElementById(id);};
  function text(id,value){el(id).textContent=String(value);}
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
    var grid=el(gridId);grid.replaceChildren();Object.keys(labels).forEach(function(key){var item=eventData&&eventData[key]||{total:0,success:0,failure:0,successRate:0};var rate=useProvidedRate&&Number.isFinite(Number(item.successRate))?Number(item.successRate):(item.total?Math.round(item.success/item.total*1000)/10:0);var box=document.createElement("div");box.className="event";var name=document.createElement("span");name.textContent=labels[key];var total=document.createElement("strong");total.textContent=String(item.total);var split=document.createElement("small");var good=document.createElement("b");good.textContent="成功 "+item.success;var bad=document.createElement("em");bad.textContent="失败 "+item.failure;split.append(good,document.createTextNode(" · "),bad,document.createTextNode(" · 成功率 "+rate+"%"));box.append(name,total,split);grid.append(box);});
  }
  function renderSummary(data){
    text("uniqueUsers",data.today.uniqueUsers);text("activeUsers",data.today.activeUsers5m);text("requestCount",data.today.requestCount);text("averageMs",data.today.averageResponseTimeMs);text("p95Ms",data.today.p95ResponseTimeMs);
    renderEventGrid("eventGrid",data.events,false);var lifetime=data.lifetime||{registeredUsers:0,requestCount:0,averageResponseTimeMs:0,p95ResponseTimeMs:0,monitoringStartedAt:null,events:{}};text("registeredUsers",lifetime.registeredUsers);text("lifetimeRequestCount",lifetime.requestCount);text("lifetimeAverageMs",lifetime.averageResponseTimeMs);text("lifetimeP95Ms",lifetime.p95ResponseTimeMs);renderEventGrid("lifetimeEventGrid",lifetime.events,true);if(lifetime.monitoringStartedAt){var startedAt=new Date(lifetime.monitoringStartedAt);var generatedAt=new Date(data.generatedAt);var days=Math.max(1,Math.ceil((generatedAt.getTime()-startedAt.getTime())/86400000));text("monitoringDays",days);text("monitoringStart","累计统计自 "+startedAt.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})+" 起");}else{text("monitoringDays",0);text("monitoringStart","尚无监控数据");}
  }
  function renderChart(data){
    var svg=el("requestChart");svg.replaceChildren();var points=data.points||[];var max=Math.max.apply(null,points.map(function(p){return Number(p.requestCount)||0;}));el("chartEmpty").hidden=max>0;if(!points.length)return;
    var width=800,height=260,pad=28;for(var i=0;i<4;i++){var line=document.createElementNS("http://www.w3.org/2000/svg","line");var y=pad+i*(height-pad*2)/3;line.setAttribute("x1",pad);line.setAttribute("x2",width-pad);line.setAttribute("y1",y);line.setAttribute("y2",y);line.setAttribute("class","grid-line");svg.append(line);}[[pad-4,pad+4,String(max),"end"],[pad-4,height-pad+4,"0","end"],[pad,height-7,new Date(points[0].timestamp).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),"start"],[width-pad,height-7,new Date(points[points.length-1].timestamp).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}),"end"]].forEach(function(item){var label=document.createElementNS("http://www.w3.org/2000/svg","text");label.setAttribute("x",item[0]);label.setAttribute("y",item[1]);label.setAttribute("text-anchor",item[3]);label.setAttribute("class","chart-label");label.textContent=item[2];svg.append(label);});
    var coords=points.map(function(p,index){return [pad+index*(width-pad*2)/Math.max(1,points.length-1),height-pad-(Number(p.requestCount)||0)*(height-pad*2)/Math.max(1,max)];});var path=coords.map(function(p,index){return(index?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1);}).join(" ");var area=document.createElementNS("http://www.w3.org/2000/svg","path");area.setAttribute("d",path+" L "+(width-pad)+" "+(height-pad)+" L "+pad+" "+(height-pad)+" Z");area.setAttribute("class","chart-area");var stroke=document.createElementNS("http://www.w3.org/2000/svg","path");stroke.setAttribute("d",path);stroke.setAttribute("class","chart-line");svg.append(area,stroke);
  }
  function renderErrors(data){var body=el("errorRows");body.replaceChildren();var rows=data.errors||[];el("errorsEmpty").hidden=rows.length>0;rows.forEach(function(item){var tr=document.createElement("tr");[labels[item.eventType]||item.eventType,item.errorType,item.count,new Date(item.lastOccurredAt).toLocaleString("zh-CN",{hour12:false})].forEach(function(value){var td=document.createElement("td");td.textContent=String(value);tr.append(td);});body.append(tr);});}
  function renderHealth(data){var expressOk=data.service&&data.service.status==="ok";text("expressStatus",expressOk?"正常":"异常");el("expressStatus").className=expressOk?"ok":"bad";text("serviceUptime",data.service?Math.floor(data.service.uptimeSeconds/60)+" 分钟":"—");var status=data.postgres&&data.postgres.status==="ok";text("postgresStatus",status?"正常":"异常");el("postgresStatus").className=status?"ok":"bad";text("postgresLatency",data.postgres?data.postgres.latencyMs+" ms":"—");}
  function startPolling(){clearPolling();polling=true;loop("summary","/admin/metrics/summary",5000,renderSummary);loop("health","/admin/health",5000,renderHealth);loop("timeseries","/admin/metrics/timeseries?range=60m&bucket=minute",15000,renderChart);loop("errors","/admin/metrics/errors?limit=20",15000,renderErrors);}
  el("loginForm").addEventListener("submit",function(event){event.preventDefault();adminKey=el("adminKey").value;el("adminKey").value="";text("loginError","");el("loginPanel").hidden=true;el("dashboard").hidden=false;startPolling();});
  document.addEventListener("visibilitychange",function(){if(document.hidden){timers.forEach(window.clearTimeout);timers=[];}else if(adminKey){startPolling();}});
})();
