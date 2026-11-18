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
  list.innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Account</th><th>File</th><th>Period</th><th>Rows</th><th>Status</th><th>Imported</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.account_label)+'</td><td>'+esc(r.source_file_name)+'</td><td>'+esc(r.period_start)+' – '+esc(r.period_end)+'</td><td>'+esc(r.row_count)+'</td><td>'+esc(r.status)+'</td><td>'+esc(new Date(r.imported_at).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"}))+'</td></tr>').join("")+'</tbody></table></div>':'<p class="muted">No bank statements have been imported yet.</p>';
 }catch(error){list.innerHTML='<p class="muted">'+esc(error.message)+'</p>';}
}
async function importCurrent(){
 if(busy)return;
 const preview=window.__bankStatementPreview;
 if(!preview||!Array.isArray(preview.rows)||!preview.rows.length)throw new Error("Generate a valid preview before importing.");
 const account=$("account").value.trim(),file=$("file").files&&$("file").files[0],start=$("periodStart").value,end=$("periodEnd").value;
 if(!account)throw new Error("Enter an account label before importing.");
 if(!file)throw new Error("Choose the original CSV file again before importing.");\n if(preview.file!==file)throw new Error("The selected file has changed since preview. Generate a new preview before importing.");
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