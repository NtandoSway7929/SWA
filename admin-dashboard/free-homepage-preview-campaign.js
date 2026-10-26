(function () {
  "use strict";
  var ROOT_ID = "sway-campaign-settings";
  var STORAGE_KEY = "swayphics_free_homepage_preview_campaign_v1";
  var DEFAULTS = { name:"Free Homepage Preview",status:"draft",startDate:"",durationDays:7,conceptSlots:3,channels:["facebook_page","facebook_groups"],websiteStartingPrice:1500,conceptMinutesLimit:90,leads:0,qualifiedLeads:0,conceptsPrepared:0,quotesSent:0,depositsReceived:0,notes:"" };
  function readConfig() {
    var config;
    try { config = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); }
    catch (error) { config = Object.assign({}, DEFAULTS); }
    if (!Array.isArray(config.channels)) config.channels = DEFAULTS.channels.slice();
    if (config.status === "active" && config.startDate && dateOnly(new Date()) > endDate(config)) config.status = "ended";
    return config;
  }
  function writeConfig(config) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); return true; } catch (error) { return false; } }
  function dateOnly(date) { return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"); }
  function endDate(config) { if (!config.startDate) return ""; var date = new Date(config.startDate+"T12:00:00"); if (Number.isNaN(date.getTime())) return ""; date.setDate(date.getDate()+Math.max(1,Number(config.durationDays)||7)-1); return dateOnly(date); }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];}); }
  function field(label,name,value,type,min,max) { return '<label class="swcp-field"><span>'+label+'</span><input type="'+type+'" name="'+name+'" value="'+esc(value)+'"'+(min!=null?' min="'+min+'"':'')+(max!=null?' max="'+max+'"':'')+'></label>'; }
  function statusOptions(status) { return [["draft","Draft"],["active","Active"],["paused","Paused"],["ended","Ended"]].map(function(x){return '<option value="'+x[0]+'"'+(status===x[0]?" selected":"")+'>'+x[1]+'</option>';}).join(""); }
  function channelCheckbox(config,key,label) { return '<label class="swcp-check"><input type="checkbox" name="channel" value="'+key+'"'+(config.channels.indexOf(key)>=0?" checked":"")+'><span>'+label+'</span></label>'; }
  function render() {
    var tablist=document.querySelector("#sway-settings-expanded .swe-tabs"), panels=document.querySelector("#sway-settings-expanded .swe-panels");
    if(!tablist||!panels)return false; if(document.getElementById(ROOT_ID))return true;
    var config=readConfig(), tab=document.createElement("button");
    tab.type="button";tab.className="swe-tab";tab.id="swe-tab-campaign";tab.setAttribute("role","tab");tab.setAttribute("aria-controls","swe-panel-campaign");tab.setAttribute("aria-selected","false");tab.setAttribute("aria-pressed","false");tab.tabIndex=-1;tab.setAttribute("data-settings-tab","campaign");tab.textContent="Campaign";tablist.appendChild(tab);
    var panel=document.createElement("section");panel.className="swe-panel";panel.id="swe-panel-campaign";panel.setAttribute("role","tabpanel");panel.setAttribute("aria-labelledby","swe-tab-campaign");panel.setAttribute("data-settings-panel","campaign");panel.hidden=true;
    panel.innerHTML='<div id="'+ROOT_ID+'"><div class="swcp-heading"><div><span class="swcp-eyebrow">Temporary sales experiment</span><h3>Free Homepage Preview</h3><p>Configure the seven-day campaign and track its funnel. This configuration is saved in this browser only; it does not publish posts or alter lead records.</p></div><span class="swcp-status" data-campaign-status-badge>Draft</span></div>'+
      '<form data-campaign-form><div class="swcp-grid"><label class="swcp-field"><span>Campaign status</span><select name="status">'+statusOptions(config.status)+'</select></label>'+
      field("Campaign name","name",config.name,"text")+field("Start date","startDate",config.startDate,"date")+field("Duration (days)","durationDays",config.durationDays,"number",1,30)+
      field("Available homepage concepts","conceptSlots",config.conceptSlots,"number",0,20)+field("Website projects from (R)","websiteStartingPrice",config.websiteStartingPrice,"number",0,1000000)+field("Max concept production time (minutes)","conceptMinutesLimit",config.conceptMinutesLimit,"number",15,480)+'</div>'+
      '<div class="swcp-subsection"><h4>Campaign channels</h4><div class="swcp-checks">'+channelCheckbox(config,"facebook_page","Swayphics Facebook Page")+channelCheckbox(config,"facebook_groups","Relevant Facebook groups")+'</div></div>'+
      '<div class="swcp-subsection"><h4>Conversion tracking</h4><p>Update counts manually as the campaign progresses. These counters do not modify the main lead pipeline.</p><div class="swcp-grid">'+
      field("Leads received","leads",config.leads,"number",0,100000)+field("Qualified leads","qualifiedLeads",config.qualifiedLeads,"number",0,100000)+field("Concepts prepared","conceptsPrepared",config.conceptsPrepared,"number",0,100000)+field("Quotes sent","quotesSent",config.quotesSent,"number",0,100000)+field("Deposits received","depositsReceived",config.depositsReceived,"number",0,100000)+'</div></div>'+
      '<div class="swcp-subsection"><h4>Success definition</h4><p class="swcp-goal">Primary goal: close the first paying website client. The free offer is limited to a homepage concept preview, not a free completed website.</p><label class="swcp-field"><span>Internal notes</span><textarea name="notes" rows="3" placeholder="Record decisions, constraints or lessons">'+esc(config.notes)+'</textarea></label></div>'+
      '<div class="swcp-summary" data-campaign-summary></div><div class="swcp-actions"><button type="submit" class="swe-button swe-button-primary">Save campaign configuration</button><button type="button" class="swe-button" data-campaign-reset>Reset to defaults</button></div><p class="swcp-feedback" data-campaign-feedback role="status" aria-live="polite"></p></form></div>';
    panels.appendChild(panel);
    tab.addEventListener("click",function(){selectCampaignTab(tab,panel);});
    tab.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();selectCampaignTab(tab,panel);}});
    var form=panel.querySelector("[data-campaign-form]");
    form.addEventListener("submit",function(event){
      event.preventDefault();var data=new FormData(form),next=Object.assign({},DEFAULTS,readConfig());
      ["name","startDate","notes"].forEach(function(k){next[k]=String(data.get(k)||"").trim();});
      ["durationDays","conceptSlots","websiteStartingPrice","conceptMinutesLimit","leads","qualifiedLeads","conceptsPrepared","quotesSent","depositsReceived"].forEach(function(k){var n=Number(data.get(k));next[k]=Number.isFinite(n)?Math.max(0,n):DEFAULTS[k];});
      next.status=String(data.get("status")||"draft");next.channels=Array.from(form.querySelectorAll('input[name="channel"]:checked')).map(function(i){return i.value;});
      if(next.status==="active"&&!next.startDate)next.startDate=dateOnly(new Date());
      if(next.status==="active"&&next.startDate&&dateOnly(new Date())>endDate(next))next.status="ended";
      if(!writeConfig(next)){feedback("Could not save: browser storage is unavailable or full.",true);return;}
      renderValues(next);feedback(next.status==="ended"?"Saved. The campaign is marked ended because its campaign window has passed.":"Campaign configuration saved in this browser.",false);
    });
    panel.querySelector("[data-campaign-reset]").addEventListener("click",function(){
      if(!window.confirm("Reset this campaign configuration and its manual counters to the default draft?"))return;
      try{localStorage.removeItem(STORAGE_KEY);}catch(error){}
      panel.remove();tab.remove();render();
      selectCampaignTab(document.getElementById("swe-tab-campaign"),document.getElementById("swe-panel-campaign"));
    });
    renderValues(config);return true;
  }
  function selectCampaignTab(tab,panel){
    var root=document.getElementById("sway-settings-expanded");if(!root)return;
    root.querySelectorAll("[data-settings-tab]").forEach(function(item){var active=item===tab;item.setAttribute("aria-selected",active?"true":"false");item.setAttribute("aria-pressed",active?"true":"false");item.tabIndex=active?0:-1;});
    root.querySelectorAll("[data-settings-panel]").forEach(function(item){var active=item===panel;item.hidden=!active;item.setAttribute("aria-hidden",active?"false":"true");if(active)item.style.setProperty("display","grid","important");else item.style.removeProperty("display");});
    tab.focus();
  }
  function renderValues(config){
    var panel=document.getElementById("swe-panel-campaign");if(!panel)return;var form=panel.querySelector("[data-campaign-form]");if(!form)return;
    ["name","status","startDate","durationDays","conceptSlots","websiteStartingPrice","conceptMinutesLimit","leads","qualifiedLeads","conceptsPrepared","quotesSent","depositsReceived","notes"].forEach(function(k){var input=form.elements.namedItem(k);if(input)input.value=config[k]==null?"":config[k];});
    form.querySelectorAll('input[name="channel"]').forEach(function(input){input.checked=config.channels.indexOf(input.value)>=0;});
    var badge=panel.querySelector("[data-campaign-status-badge]");if(badge){badge.textContent=config.status.charAt(0).toUpperCase()+config.status.slice(1);badge.setAttribute("data-status",config.status);}
    var end=endDate(config),summary=panel.querySelector("[data-campaign-summary]");
    if(summary)summary.innerHTML='<div><span>Campaign window</span><strong>'+esc(config.startDate||"Not scheduled")+'</strong><small>Ends '+esc(end||"not calculated")+'</small></div><div><span>Funnel progress</span><strong>'+esc(config.leads)+' leads → '+esc(config.qualifiedLeads)+' qualified</strong><small>'+esc(config.quotesSent)+' quotes · '+esc(config.depositsReceived)+' deposits</small></div><div><span>Offer capacity</span><strong>'+esc(config.conceptSlots)+' concepts</strong><small>Max '+esc(config.conceptMinutesLimit)+' minutes per concept</small></div>';
  }
  function feedback(message,error){var node=document.querySelector("#swe-panel-campaign [data-campaign-feedback]");if(node){node.textContent=message;node.setAttribute("data-error",error?"true":"false");}}
  function start(){
    if(render())return;
    if(!document.documentElement||typeof MutationObserver==="undefined")return;
    var observer=new MutationObserver(function(){
      if(render())observer.disconnect();
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    window.setTimeout(function(){observer.disconnect();},30000);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();