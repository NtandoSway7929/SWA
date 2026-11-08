(function () {
  "use strict";
  const URL = "https://sqifhribgsqfaxgtobsa.supabase.co";
  const KEY = "sb_publishable_kV_YWij7nHIHjyr3Uv2iIA_PIhr-QhB";
  const endpoint = URL + "/functions/v1/admin-client-onboarding-assets";
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const size = bytes => { const n = Number(bytes || 0); if (n < 1024) return n + " B"; if (n < 1048576) return (n/1024).toFixed(1)+" KB"; return (n/1048576).toFixed(1)+" MB"; };
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? "Date unavailable" : d.toLocaleString("en-ZA",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); };
  function style() {
    if (document.getElementById("sway-onboarding-assets-admin-style")) return;
    const el = document.createElement("style"); el.id = "sway-onboarding-assets-admin-style";
    el.textContent = `
      #sway-onboarding-assets-admin{display:none;margin:22px 0 30px;padding:clamp(18px,3vw,28px);border:1px solid rgba(0,32,150,.09);border-radius:22px;background:linear-gradient(145deg,#fff,#f7f9fd);box-shadow:0 16px 42px rgba(8,25,60,.06);color:#111827}
      #sway-onboarding-assets-admin.is-open{display:block}
      #sway-onboarding-assets-admin .soa-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      #sway-onboarding-assets-admin h2{margin:4px 0 6px;font-size:clamp(1.2rem,2vw,1.65rem);letter-spacing:-.035em}
      #sway-onboarding-assets-admin p{margin:0;color:#667085;font-size:.82rem;line-height:1.55}
      #sway-onboarding-assets-admin .soa-kicker{color:#0152f4;font-size:.65rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
      #sway-onboarding-assets-admin .soa-toolbar{display:flex;gap:10px;align-items:center;margin:20px 0}
      #sway-onboarding-assets-admin input{flex:1;min-width:0;padding:11px 13px;border:1px solid #dce3ef;border-radius:11px;background:#fff;color:#111827;font:inherit}
      #sway-onboarding-assets-admin button,#sway-onboarding-assets-trigger{border:0;border-radius:11px;padding:11px 15px;background:#002096;color:#fff;font-weight:750;cursor:pointer}
      #sway-onboarding-assets-admin button:disabled{opacity:.55;cursor:wait}
      #sway-onboarding-assets-admin .soa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:13px}
      #sway-onboarding-assets-admin .soa-client{min-width:0;padding:16px;border:1px solid #e5eaf2;border-radius:15px;background:#fff}
      #sway-onboarding-assets-admin .soa-client h3{margin:0 0 4px;font-size:.96rem}
      #sway-onboarding-assets-admin .soa-client-meta{margin-bottom:13px;color:#7b8494;font-size:.72rem}
      #sway-onboarding-assets-admin .soa-file{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #edf0f5}
      #sway-onboarding-assets-admin .soa-thumb{width:42px;height:42px;border-radius:9px;object-fit:cover;background:#f1f4f8}
      #sway-onboarding-assets-admin .soa-file-name{min-width:0;overflow-wrap:anywhere;font-size:.78rem;font-weight:750}
      #sway-onboarding-assets-admin .soa-file-meta{margin-top:3px;color:#858d9b;font-size:.68rem}
      #sway-onboarding-assets-admin .soa-file-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      #sway-onboarding-assets-admin .soa-file-actions a{padding:7px 9px;border:1px solid #dce3ef;border-radius:8px;color:#002096;text-decoration:none;font-size:.7rem;font-weight:750}
      #sway-onboarding-assets-admin .soa-state{padding:22px 12px;border:1px dashed #d6deeb;border-radius:12px;color:#697386;text-align:center;font-size:.82rem}
      #sway-onboarding-assets-admin .soa-close{background:#eef2f8;color:#25324a}
      #sway-client360-assets .soa-client360-file{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-top:1px solid rgba(0,32,150,.06)}
      #sway-client360-assets .soa-client360-file>span:first-child{min-width:0;display:grid;gap:3px}
      #sway-client360-assets .soa-client360-file strong{overflow-wrap:anywhere;font-size:.64rem}
      #sway-client360-assets .soa-client360-file small{color:#7b8494;font-size:.54rem}
      #sway-client360-assets .soa-file-actions{display:flex;gap:6px;flex-shrink:0}
      #sway-client360-assets .soa-file-actions a{padding:6px 8px;border:1px solid rgba(0,32,150,.12);border-radius:8px;color:#002096;text-decoration:none;font-size:.56rem;font-weight:800}
      @media(max-width:560px){#sway-onboarding-assets-admin .soa-toolbar{align-items:stretch;flex-direction:column}#sway-onboarding-assets-admin .soa-file{grid-template-columns:36px minmax(0,1fr)}#sway-onboarding-assets-admin .soa-thumb{width:36px;height:36px}#sway-onboarding-assets-admin .soa-file-actions{grid-column:2;justify-content:flex-start}}
    `;
    document.head.appendChild(el);
  }
  function token() { try { return localStorage.getItem("swayphics_admin_access_token") || ""; } catch (_) { return ""; } }
  async function request(clientId) {
    const jwt = token();
    if (!jwt) throw new Error("Your admin session is missing. Please sign in again.");
    const response = await fetch(endpoint,{method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+jwt,"Content-Type":"application/json"},body:JSON.stringify({limit:200,client_id:clientId || undefined}),cache:"no-store"});
    const result = await response.json().catch(()=>({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to retrieve uploaded assets.");
    return result.files || [];
  }
  function render(files, filter) {
    const target = document.getElementById("sway-onboarding-assets-list");
    const needle = String(filter || "").trim().toLowerCase();
    const visible = files.filter(file => [file.client && file.client.business_name,file.client && file.client.contact_name,file.original_name].join(" ").toLowerCase().includes(needle));
    if (!visible.length) { target.innerHTML = '<div class="soa-state">'+(needle ? "No assets match your search." : "No onboarding assets have been uploaded yet.")+'</div>'; return; }
    const groups = new Map();
    visible.forEach(file => { const id=file.client_id; if(!groups.has(id))groups.set(id,{client:file.client,files:[]}); groups.get(id).files.push(file); });
    target.innerHTML = Array.from(groups.values()).map(group => {
      const client=group.client||{};
      return '<article class="soa-client"><h3>'+esc(client.business_name||"Client")+'</h3><div class="soa-client-meta">'+esc(client.contact_name||"")+(client.email?" · "+esc(client.email):"")+" · "+group.files.length+" file"+(group.files.length===1?"":"s")+'</div>'+
        group.files.map(file => {
          const image=String(file.mime_type||"").startsWith("image/") && file.preview_url;
          const thumb=image?'<img class="soa-thumb" src="'+esc(file.preview_url)+'" alt="" loading="lazy">':'<div class="soa-thumb" aria-hidden="true" style="display:grid;place-items:center;font-size:10px;font-weight:800;color:#3155a6">'+(file.mime_type==="application/pdf"?"PDF":"FILE")+'</div>';
          return '<div class="soa-file">'+thumb+'<div><div class="soa-file-name">'+esc(file.original_name)+'</div><div class="soa-file-meta">'+esc(size(file.size_bytes))+' · '+esc(date(file.created_at))+'</div></div><div class="soa-file-actions">'+(file.preview_url?'<a href="'+esc(file.preview_url)+'" target="_blank" rel="noopener">Preview</a>':'')+(file.download_url?'<a href="'+esc(file.download_url)+'" target="_blank" rel="noopener">Download</a>':'')+'</div></div>';
        }).join("")+'</article>';
    }).join("");
  }
  let activeClientId = null;
  document.addEventListener("click", function (event) {
    const clientAction = event.target.closest("[data-client360]");
    const notificationAction = event.target.closest("[data-notification-open]");
    if (clientAction) activeClientId = clientAction.getAttribute("data-client360");
    if (notificationAction) activeClientId = notificationAction.getAttribute("data-notification-entity-id");
  }, true);

  function mountClient360Assets() {
    const modal = document.getElementById("sway-client360-modal");
    if (!modal || !modal.querySelector(".sway-client360-card")) return;
    const card = modal.querySelector(".sway-client360-card");
    if (card.querySelector("#sway-client360-assets")) return;
    const clientId = modal.getAttribute("data-client-id") ||
      modal.getAttribute("data-client360-id") || activeClientId;
    if (!clientId) return;

    const section = document.createElement("section");
    section.id = "sway-client360-assets";
    section.className = "sway-client360-section";
    section.style.marginTop = "14px";
    section.innerHTML = '<div class="sway-client360-section-head"><h4>Business assets</h4><span id="sway-client360-assets-count">Loading</span></div><div id="sway-client360-assets-list" class="sway-client360-list"><p class="sway-client360-empty">Retrieving onboarding uploads…</p></div>';
    const footer = card.querySelector(".sway-client360-footer");
    const grid = card.querySelector(".sway-client360-grid");
    if (grid) grid.insertAdjacentElement("afterend", section);
    else if (footer) footer.insertAdjacentElement("beforebegin", section);
    else card.appendChild(section);

    request(clientId).then(files => {
      const list = section.querySelector("#sway-client360-assets-list");
      section.querySelector("#sway-client360-assets-count").textContent =
        files.length + " file" + (files.length === 1 ? "" : "s");
      if (!files.length) {
        list.innerHTML = '<p class="sway-client360-empty">No business assets have been uploaded for this client yet.</p>';
        return;
      }
      list.innerHTML = files.map(file =>
        '<div class="soa-client360-file"><span><strong>' + esc(file.original_name) +
        '</strong><small>' + esc(size(file.size_bytes)) + ' · ' + esc(date(file.created_at)) +
        '</small></span><span class="soa-file-actions">' +
        (file.preview_url ? '<a href="' + esc(file.preview_url) + '" target="_blank" rel="noopener">Preview</a>' : '') +
        (file.download_url ? '<a href="' + esc(file.download_url) + '" target="_blank" rel="noopener">Download</a>' : '') +
        '</span></div>'
      ).join("");
    }).catch(error => {
      section.querySelector("#sway-client360-assets-count").textContent = "Unavailable";
      section.querySelector("#sway-client360-assets-list").innerHTML =
        '<p class="sway-client360-empty">' + esc(error.message) + '</p>';
    });
  }

  function observeClient360() {
    if (!document.body || window.swayClient360AssetsObserver) return;
    window.swayClient360AssetsObserver = new MutationObserver(mountClient360Assets);
    window.swayClient360AssetsObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-client-id"]
    });
    mountClient360Assets();
  }

  function mount() {
    const intro=document.querySelector(".admin-intro");
    const workspace=document.getElementById("sway-admin-workspace");
    if(!intro||!workspace||document.getElementById("sway-onboarding-assets-admin"))return;
    style();
    const trigger=document.createElement("button");trigger.type="button";trigger.id="sway-onboarding-assets-trigger";trigger.textContent="Review business assets";
    trigger.style.marginTop="14px";intro.appendChild(trigger);
    const panel=document.createElement("section");panel.id="sway-onboarding-assets-admin";panel.setAttribute("aria-label","Client onboarding business assets");
    panel.innerHTML='<div class="soa-head"><div><span class="soa-kicker">Client onboarding</span><h2>Business assets</h2><p>Files submitted by clients during onboarding, grouped by business.</p></div><div style="display:flex;gap:8px"><button type="button" id="soa-refresh">Refresh</button><button type="button" class="soa-close" id="soa-close">Close</button></div></div><div class="soa-toolbar"><input id="soa-search" type="search" placeholder="Search businesses or files" aria-label="Search business assets"><span id="soa-count" style="color:#667085;font-size:.76rem"></span></div><div id="sway-onboarding-assets-list"><div class="soa-state">Open Business Assets to load client uploads.</div></div>';
    workspace.insertAdjacentElement("afterend",panel);
    let files=[];
    const load=async()=>{const list=document.getElementById("sway-onboarding-assets-list");list.innerHTML='<div class="soa-state">Loading securely stored assets…</div>';document.getElementById("soa-refresh").disabled=true;try{files=await request();document.getElementById("soa-count").textContent=files.length+" file"+(files.length===1?"":"s");render(files,document.getElementById("soa-search").value);}catch(error){list.innerHTML='<div class="soa-state">'+esc(error.message)+'</div>';}finally{document.getElementById("soa-refresh").disabled=false;}};
    trigger.addEventListener("click",()=>{panel.classList.toggle("is-open");if(panel.classList.contains("is-open"))load();panel.scrollIntoView({behavior:"smooth",block:"start"});});
    document.getElementById("soa-close").addEventListener("click",()=>panel.classList.remove("is-open"));
    document.getElementById("soa-refresh").addEventListener("click",load);
    document.getElementById("soa-search").addEventListener("input",event=>render(files,event.target.value));
  }
  function start() {
    const ready=window.swayphicsAdminSessionReady;
    Promise.resolve(ready).then(valid=>{if(valid===false)return;mount();observeClient360();}).catch(()=>{});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
