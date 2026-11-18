(function(){
"use strict";
const URL="https://sqifhribgsqfaxgtobsa.supabase.co";
const KEY="sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
const ACCESS="swayphics_admin_access_token",REFRESH="swayphics_admin_refresh_token";
const $=id=>document.getElementById(id);
let busy=false;
function token(){try{return localStorage.getItem(ACCESS)||"";}catch(_){return "";}}
async function refresh(){
 let value="";try{value=localStorage.getItem(REFRESH)||"";}catch(_){}
 if(!value)return false;
 const response=await fetch(URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{"apikey":KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:value})});
 if(!response.ok)return false;
 const data=await response.json();if(!data.access_token||!data.refresh_token)return false;
 localStorage.setItem(ACCESS,data.access_token);localStorage.setItem(REFRESH,data.refresh_token);return true;
}
async function request(path,options,retried){
 const access=token();if(!access)throw new Error("Your administrator session is missing. Sign in to the dashboard, then reopen this page.");
 const response=await fetch(URL+path,Object.assign({headers:{"apikey":KEY,"Authorization":"Bearer "+access,"Accept":"application/json","Content-Type":"application/json"}},options||{}));
 if(response.status===401&&!retried&&await refresh())return request(path,options,true);
 const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch(_){}
 if(!response.ok)throw new Error(data&&(data.message||data.error||data.hint)||"The bank statement request failed ("+response.status+").");
 return data;
}
function setStatus(message,bad){const node=$("importStatus");if(node){node.textContent=message;node.className="notice"+(bad?" error":"");}}
function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function money(value){return new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(Number(value||0));}
async function digest(buffer){const hash=await crypto.subtle.digest("SHA-256",buffer);return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,"0")).join("");}
async function fingerprint(row){return digest(new TextEncoder().encode(JSON.stringify([row.transaction_date,row.description,row.bank_reference||"",Number(row.amount).toFixed(2)])));}
async function loadImports(){
 const list=$("savedImports");if(!list)return;
 if(!token()){list.innerHTML='<p class="muted">Sign in to the admin dashboard to view saved statements.</p>';return;}
 try{
  const rows=await request("/rest/v1/bank_statement_imports?select=id,account_label,source_file_name,period_start,period_end,row_count,status,imported_at&order=imported_at.desc&limit=50",{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}});
  if(!Array.isArray(rows))throw new Error("The saved statement list response was invalid.");
  list.innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Account</th><th>File</th><th>Period</th><th>Rows</th><th>Status</th><th>Imported</th><th>Review</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.account_label)+'</td><td>'+esc(r.source_file_name)+'</td><td>'+esc(r.period_start)+' – '+esc(r.period_end)+'</td><td>'+esc(r.row_count)+'</td><td>'+esc(r.status)+'</td><td>'+esc(new Date(r.imported_at).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"}))+'</td><td><button class="btn" type="button" data-review-import="'+esc(r.id)+'">Review lines</button></td></tr>').join("")+'</tbody></table></div>':'<p class="muted">No bank statements have been imported yet.</p>';
 }catch(error){list.innerHTML='<p class="muted">'+esc(error.message)+'</p>';}
}
let activeReviewImport=null;
let activeReviewOffset=0;
let activeReviewPool=null;
const REVIEW_PAGE_SIZE=100;
function shiftDate(value,days){
 const date=new Date(value+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+days);
 return date.toISOString().slice(0,10);
}
function dateDistance(a,b){
 const left=Date.parse(a+"T00:00:00Z"),right=Date.parse(b+"T00:00:00Z");
 return Number.isFinite(left)&&Number.isFinite(right)?Math.abs(Math.round((left-right)/86400000)):99999;
}
async function loadReviewPool(importRecord){
 const start=shiftDate(importRecord.period_start,-7),end=shiftDate(importRecord.period_end,7);
 const [payments,entries,matched]=await Promise.all([
  request("/rest/v1/payments?select=id,amount,paid_at,reference,method,invoice:invoices(invoice_number)&status=eq.paid&provider=is.null&currency=eq.ZAR&paid_at=gte."+start+"&paid_at=lte."+end+"&limit=1000",{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}}),
  request("/rest/v1/budget_entries?select=id,amount,transaction_date,entry_type,category,description,counterparty,reference&status=eq.posted&currency=eq.ZAR&transaction_date=gte."+start+"&transaction_date=lte."+end+"&limit=1000",{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}}),
  request("/rest/v1/bank_statement_lines?select=matched_source_type,matched_source_id&match_status=eq.matched&limit=10000",{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}})
 ]);
 const used=new Set((matched||[]).map(x=>x.matched_source_type+":"+x.matched_source_id));
 return {payments:Array.isArray(payments)?payments:[],entries:Array.isArray(entries)?entries:[],used};
}
function candidateList(line,pool){
 const amount=Math.abs(Number(line.amount)),credit=Number(line.amount)>0,choices=[];
 if(credit){
  pool.payments.forEach(p=>{if(Number(p.amount)===amount&&p.paid_at&&dateDistance(p.paid_at,line.transaction_date)<=7&&!pool.used.has("payment:"+p.id)){
   const invoice=p.invoice&&p.invoice.invoice_number?" · "+p.invoice.invoice_number:"";
   choices.push({type:"payment",id:p.id,label:"Payment"+invoice+" · "+(p.method||"")+(p.reference?" · "+p.reference:"")+" · "+p.paid_at+" · "+money(p.amount)});
  }});
 }
 pool.entries.forEach(e=>{
  const expected=credit?"income":"expense",date=e.transaction_date;
  if(e.entry_type===expected&&Number(e.amount)===amount&&date&&dateDistance(date,line.transaction_date)<=7&&!pool.used.has("budget_entry:"+e.id)){
   choices.push({type:"budget_entry",id:e.id,label:(credit?"Income":"Expense")+" · "+(e.category||"Uncategorised")+" · "+(e.description||e.counterparty||"Budget entry")+" · "+date+" · "+money(e.amount)});
  }
 });
 return choices;
}
async function reviewImport(importId,offset){
 activeReviewImport=importId;activeReviewOffset=offset||0;
 const panel=$("statementReview"),body=$("reviewLines");
 panel.classList.remove("hidden");body.innerHTML='<p class="muted">Loading statement lines and possible matches…</p>';
 try{
  const imports=await request("/rest/v1/bank_statement_imports?select=id,account_label,period_start,period_end,row_count&id=eq."+encodeURIComponent(importId)+"&limit=1",{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}});
  const record=Array.isArray(imports)&&imports[0];if(!record)throw new Error("The selected statement could not be found.");
  if(!activeReviewPool||activeReviewPool.importId!==importId){activeReviewPool=await loadReviewPool(record);activeReviewPool.importId=importId;}
  const lines=await request("/rest/v1/bank_statement_lines?select=id,row_number,transaction_date,description,bank_reference,amount,match_status,matched_source_type,ignore_reason&import_id=eq."+encodeURIComponent(importId)+"&order=row_number.asc&limit="+(REVIEW_PAGE_SIZE+1)+"&offset="+activeReviewOffset,{method:"GET",headers:{"apikey":KEY,"Authorization":"Bearer "+token(),"Accept":"application/json"}});
  if(!Array.isArray(lines))throw new Error("The statement line response was invalid.");
  const hasMore=lines.length>REVIEW_PAGE_SIZE,page=lines.slice(0,REVIEW_PAGE_SIZE);
  const matched=page.filter(x=>x.match_status==="matched").length,ignored=page.filter(x=>x.match_status==="ignored").length,unmatched=page.length-matched-ignored;
  $("reviewHeading").textContent=record.account_label+" · "+record.period_start+" to "+record.period_end;
  $("reviewSummary").textContent=matched+" matched · "+ignored+" ignored · "+unmatched+" awaiting review (this page). Candidate suggestions require exact amount and a date within seven days. Every match is manual.";
  body.innerHTML=page.map(line=>{
   const candidates=line.match_status==="unmatched"?candidateList(line,activeReviewPool):[];
   const amount=money(Math.abs(Number(line.amount)));
   const direction=Number(line.amount)>0?"Credit":"Debit";
   let decision="";
   if(line.match_status==="matched")decision='<span class="notice success">Matched to '+esc(line.matched_source_type||"record")+'</span>';
   else if(line.match_status==="ignored")decision='<span class="notice">Ignored · '+esc(line.ignore_reason||"No reason recorded")+'</span>';
   else if(candidates.length){
    decision='<div class="review-actions"><select data-match-choice="'+esc(line.id)+'"><option value="">Choose a record…</option>'+candidates.map(x=>'<option value="'+x.type+':'+x.id+'">'+esc(x.label)+'</option>').join("")+'</select><button class="btn primary" type="button" data-match-line="'+esc(line.id)+'">Match</button></div>';
   }else decision='<span class="muted">No exact-amount candidate within seven days.</span>';
   const ignore=line.match_status==="unmatched"?'<div class="review-actions"><input type="text" maxlength="1000" placeholder="Reason for ignoring" data-ignore-reason="'+esc(line.id)+'"><button class="btn" type="button" data-ignore-line="'+esc(line.id)+'">Ignore</button></div>':"";
   return '<article class="review-row"><div class="review-row-main"><div><strong>Row '+esc(line.row_number)+' · '+esc(line.transaction_date)+' · '+direction+'</strong><p>'+esc(line.description)+'</p><small>'+esc(line.bank_reference||"No bank reference")+' · '+amount+'</small></div><span class="review-state">'+esc(line.match_status)+'</span></div><div class="review-decision">'+decision+ignore+'</div></article>';
  }).join("")||'<p class="muted">No transaction lines were found in this statement.</p>';
  $("reviewPagination").innerHTML='<button class="btn" type="button" data-review-prev '+(activeReviewOffset===0?'disabled':'')+'>Previous</button><span class="muted">Rows '+(activeReviewOffset+1)+'–'+(activeReviewOffset+page.length)+' of '+record.row_count+'</span><button class="btn" type="button" data-review-next '+(!hasMore?'disabled':'')+'>Next</button>';
  panel.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(error){body.innerHTML='<p class="notice error">'+esc(error.message)+'</p>';}
}
async function submitLineReview(lineId,decision){
 const button=document.querySelector('[data-match-line="'+lineId+'"],[data-ignore-line="'+lineId+'"]');
 if(button)button.disabled=true;
 try{
  let payload={p_line_id:lineId,p_decision:decision,p_source_type:null,p_source_id:null,p_ignore_reason:null};
  if(decision==="matched"){
   const select=document.querySelector('[data-match-choice="'+lineId+'"]');
   const parts=(select&&select.value||"").split(":");
   if(parts.length!==2||!parts[0]||!parts[1])throw new Error("Choose a suggested financial record first.");
   payload.p_source_type=parts[0];payload.p_source_id=parts[1];
  }else{
   const input=document.querySelector('[data-ignore-reason="'+lineId+'"]');
   payload.p_ignore_reason=(input&&input.value||"").trim();
   if(!payload.p_ignore_reason)throw new Error("Enter a reason before ignoring this bank line.");
  }
  const result=await request("/rest/v1/rpc/review_bank_statement_line",{method:"POST",body:JSON.stringify(payload)});
  if(!result||result.ok!==true)throw new Error("The server did not confirm the review decision.");
  activeReviewPool=null;
  await reviewImport(activeReviewImport,activeReviewOffset);
 }catch(error){
  const status=$("reviewActionStatus");status.textContent=error.message;status.classList.add("error");
  if(button)button.disabled=false;
 }
}
async function importCurrent(){
 if(busy)return;
 const preview=window.__bankStatementPreview;
 if(!preview||!Array.isArray(preview.rows)||!preview.rows.length)throw new Error("Generate a valid preview before importing.");
 const account=$("account").value.trim(),file=$("file").files&&$("file").files[0],start=$("periodStart").value,end=$("periodEnd").value;
 if(!account)throw new Error("Enter an account label before importing.");
 if(!file)throw new Error("Choose the original CSV file again before importing.");
 if(preview.file!==file)throw new Error("The selected file has changed since preview. Generate a new preview before importing.");
 if(!start||!end||end<start)throw new Error("The statement period is invalid.");
 if(preview.rows.length>10000)throw new Error("A statement import is limited to 10,000 valid rows.");
 if(!crypto||!crypto.subtle)throw new Error("This browser does not support secure SHA-256 fingerprinting. Use a current browser over HTTPS.");
 busy=true;const button=$("saveImport");button.disabled=true;
 try{
  setStatus("Fingerprinting the statement locally…",false);
  const fileHash=await digest(await file.arrayBuffer());
  const rows=[];
  for(const row of preview.rows){
   rows.push({row_number:row.row_number,transaction_date:row.transaction_date,description:row.description,bank_reference:row.bank_reference||"",amount:Number(row.amount).toFixed(2),line_fingerprint:await fingerprint(row)});
  }
  setStatus("Saving the statement and its "+rows.length+" transaction rows atomically…",false);
  const result=await request("/rest/v1/rpc/import_bank_statement",{method:"POST",body:JSON.stringify({
   p_account_label:account,p_source_file_name:file.name,p_source_file_sha256:fileHash,
   p_period_start:start,p_period_end:end,p_rows:rows
  })});
  if(!result||result.ok!==true||!result.import_id||Number(result.row_count)!==rows.length)throw new Error("The server did not confirm the complete statement import. Refresh the saved statements list before retrying.");
  setStatus("Statement imported successfully: "+result.row_count+" transaction rows saved. No income, expense, payment or invoice records were changed.",false);
  $("saveImport").classList.add("hidden");
  await loadImports();
 }catch(error){setStatus(error.message||"Statement import failed.",true);}
 finally{busy=false;button.disabled=false;}
}
function mount(){
 const panel=$("previewPanel");if(!panel)return;
 const actions=document.createElement("div");actions.className="actions";
 actions.innerHTML='<button id="saveImport" class="btn primary" type="button">Import statement</button>';
 panel.appendChild(actions);
 const status=document.createElement("div");status.id="importStatus";status.className="notice";status.setAttribute("role","status");status.setAttribute("aria-live","polite");status.textContent="Import saves the validated statement rows only. It does not post income or expenses.";
 panel.appendChild(status);
 const history=document.createElement("section");history.className="panel";history.innerHTML='<h2>Previously imported statements</h2><p class="muted">The latest 50 statement imports for this account are shown here.</p><div id="savedImports" style="margin-top:14px"><p class="muted">Loading saved statements…</p></div>';
 panel.insertAdjacentElement("afterend",history);
 const review=document.createElement("section");review.id="statementReview";review.className="panel hidden";review.innerHTML='<h2>Statement line review</h2><p id="reviewHeading" class="muted"></p><p id="reviewSummary" class="notice"></p><p class="muted">Suggestions include paid manual payments and posted budget entries only. Yoco provider/test transactions and test-environment refunds are excluded. Matching only links existing records; it never creates or changes income, expenses, payments or invoices.</p><div id="reviewLines"></div><div id="reviewPagination" class="actions"></div><div id="reviewActionStatus" class="notice" role="status" aria-live="polite"></div>';
 history.insertAdjacentElement("afterend",review);
 history.addEventListener("click",function(event){const btn=event.target.closest("[data-review-import]");if(btn)reviewImport(btn.getAttribute("data-review-import"),0);});
 review.addEventListener("click",function(event){
  const match=event.target.closest("[data-match-line]"),ignore=event.target.closest("[data-ignore-line]");
  const prev=event.target.closest("[data-review-prev]"),next=event.target.closest("[data-review-next]");
  if(match)submitLineReview(match.getAttribute("data-match-line"),"matched");
  else if(ignore)submitLineReview(ignore.getAttribute("data-ignore-line"),"ignored");
  else if(prev&&activeReviewOffset>=REVIEW_PAGE_SIZE)reviewImport(activeReviewImport,activeReviewOffset-REVIEW_PAGE_SIZE);
  else if(next)reviewImport(activeReviewImport,activeReviewOffset+REVIEW_PAGE_SIZE);
 });
 $("mapping").addEventListener("change",function(){
  window.__bankStatementPreview=null;$("saveImport").classList.add("hidden");$("previewPanel").classList.add("hidden");setStatus("Column mapping changed. Generate a fresh preview before importing.",false);
 });
 ["file","account","periodStart","periodEnd"].forEach(function(id){
  $(id).addEventListener("change",function(){
   window.__bankStatementPreview=null;
   $("saveImport").classList.add("hidden");
   $("previewPanel").classList.add("hidden");
   setStatus("Statement details changed. Generate a fresh preview before importing.",false);
  });
 });
 $("saveImport").addEventListener("click",importCurrent);
 window.addEventListener("bank:preview-ready",function(){ $("saveImport").classList.remove("hidden");setStatus("Ready to import. The file hash and transaction fingerprints will be generated locally.",false); });
 loadImports();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
})();