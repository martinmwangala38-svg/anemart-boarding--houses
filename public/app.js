const $ = (s, root=document) => root.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => "K" + Number(n || 0).toLocaleString("en-ZM");
let listings = [];
let config = {};
const fallbackImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="100%" height="100%" fill="#eaf1f9"/><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="30" fill="#0d3b66">ANEMART Room</text></svg>');

async function request(url, options={}) {
  const res = await fetch(url, { headers: {"Content-Type":"application/json", ...(options.headers||{})}, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
function imageUrl(url) {
  if (!url) return fallbackImage;
  if (url.startsWith("/") || /^https:\/\//i.test(url)) return url;
  return "/" + url.replace(/^\.?\//,"");
}
function renderListings(items) {
  const grid=$("#listingsGrid");
  $("#resultsCount").textContent = `${items.length} ${items.length===1?"listing":"listings"} found`;
  if (!items.length) { grid.innerHTML='<div class="empty">No listings match these filters. Try a different search or submit a room request.</div>'; return; }
  grid.innerHTML=items.map(r=>`<article class="listing-card">
    <img loading="lazy" src="${esc(imageUrl(r.image_url))}" alt="${esc(r.name)}" onerror="this.onerror=null;this.src='${fallbackImage}'">
    <div class="listing-body"><span class="status ${esc(r.status)}">${r.status==="available"?"Available":r.status==="few"?"Few spaces left":"Full"}</span>
    <h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><p>📍 ${esc(r.location)} · About ${Number(r.walk_minutes)} min walk</p>
    <div class="listing-meta"><span class="tag">${esc(r.room_type)}</span><span class="tag">Room of ${Number(r.capacity)}</span>${(r.amenities||[]).slice(0,3).map(a=>`<span class="tag">${esc(a)}</span>`).join("")}</div>
    <p class="price">${money(r.price_kwacha)} <span class="small muted">/ month</span></p>
    <button class="btn apply-listing" data-id="${r.id}" ${r.status==="full"?"disabled":""}>${r.status==="full"?"Currently full":"Apply for this room"}</button></div></article>`).join("");
  grid.querySelectorAll(".apply-listing").forEach(b=>b.addEventListener("click",()=>{
    $("#applicationListing").value=b.dataset.id; location.hash="#apply"; $("#applicationForm").elements.full_name.focus();
  }));
}
async function loadListings() {
  const q=$("#searchInput").value.trim(), type=$("#typeFilter").value;
  const min=$("#minPrice").value, max=$("#maxPrice").value;
  const params=new URLSearchParams(); if(q)params.set("q",q); if(type!=="all")params.set("type",type);
  if(min!=="")params.set("min",min); if(max!=="")params.set("max",max);
  try {
    listings=await request("/api/listings?"+params.toString());
    renderListings(listings);
    $("#listingError").hidden=true;
    const select=$("#applicationListing"); const current=select.value;
    select.innerHTML='<option value="">Help me find a room</option>'+listings.map(r=>`<option value="${r.id}">${esc(r.name)} — ${money(r.price_kwacha)}/month</option>`).join("");
    if(current && [...select.options].some(o=>o.value===current))select.value=current;
  } catch(e) {
    $("#listingError").hidden=false; $("#listingError").textContent=e.message+" If you are offline, reconnect to refresh availability.";
    $("#resultsCount").textContent="Listings could not be refreshed.";
    const cached=localStorage.getItem("anemart-public-listings");
    if(cached){try{renderListings(JSON.parse(cached));}catch{}}
  }
}
async function loadConfig(){
  try {
    config=await request("/api/config");
    $("#heroFee").textContent=money(config.fee_kwacha); $("#feeAmount").textContent=money(config.fee_kwacha);
    $("#airtelName").textContent=config.airtel_name; $("#airtelNumber").textContent=config.airtel_number;
    $("#mtnName").textContent=config.mtn_name; $("#mtnNumber").textContent=config.mtn_number;
    document.querySelectorAll(".wa-link").forEach(a=>{
      const who=a.dataset.contact, num=config["whatsapp_"+who];
      if(num && /^\d{8,15}$/.test(num)){a.href="https://wa.me/"+num+"?text="+encodeURIComponent("Hello ANEMART, I need help with student accommodation.");a.hidden=false;}
      else a.hidden=true;
    });
    const any=[config.whatsapp_Anenyasha,config.whatsapp_Martin].some(n=>n && /^\d{8,15}$/.test(n));
    $("#whatsappFloat").hidden=!any;
    document.querySelectorAll("[data-missing]").forEach(p=>p.hidden=!!(config["whatsapp_"+p.dataset.missing] && /^\d{8,15}$/.test(config["whatsapp_"+p.dataset.missing])));
  } catch(e) { console.warn("Configuration unavailable",e); }
}
$("#applicationForm").addEventListener("submit",async e=>{
  e.preventDefault(); const result=$("#applicationResult"), button=e.submitter;
  result.hidden=true; button.disabled=true; button.textContent="Submitting…";
  const fd=new FormData(e.currentTarget), payload=Object.fromEntries(fd.entries());
  if(payload.listing_id)payload.listing_id=Number(payload.listing_id);else delete payload.listing_id;
  try{
    const data=await request("/api/applications",{method:"POST",body:JSON.stringify(payload)});
    result.className="notice success"; result.textContent=`${data.message} Your reference is ${data.reference}. Save it for payment verification and follow-up.`;
    result.hidden=false; e.currentTarget.reset();
  }catch(err){result.className="notice error";result.textContent=err.message;result.hidden=false;}
  finally{button.disabled=false;button.textContent="Submit application";}
});
$("#paymentForm").addEventListener("submit",async e=>{
  e.preventDefault();const result=$("#paymentResult"),button=e.submitter;result.hidden=true;button.disabled=true;
  try{const data=await request("/api/payment-submissions",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries()))});
    result.className="notice success";result.textContent=data.message;result.hidden=false;e.currentTarget.reset();
  }catch(err){result.className="notice error";result.textContent=err.message;result.hidden=false;}
  finally{button.disabled=false;}
});
let searchTimer;
["searchInput","typeFilter","minPrice","maxPrice"].forEach(id=>$("#"+id).addEventListener(id==="searchInput"?"input":"change",()=>{
  if(id==="searchInput"){clearTimeout(searchTimer);searchTimer=setTimeout(loadListings,220);}else loadListings();
}));
$("#clearFilters").addEventListener("click",()=>{$("#searchInput").value="";$("#typeFilter").value="all";$("#minPrice").value="";$("#maxPrice").value="";loadListings();});
$("#menuToggle").addEventListener("click",()=>{const nav=$("#mainNav"),open=nav.classList.toggle("open");$("#menuToggle").setAttribute("aria-expanded",String(open));});
$("#mainNav").querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>$("#mainNav").classList.remove("open")));
$("#whatsappToggle").addEventListener("click",()=>{$("#whatsappChoices").hidden=!$("#whatsappChoices").hidden;});
function offlineState(){ $("#offlineBanner").hidden=navigator.onLine; }
window.addEventListener("online",()=>{offlineState();loadListings();});
window.addEventListener("offline",offlineState);
$("#year").textContent=new Date().getFullYear();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(console.warn));
offlineState();loadConfig();loadListings();
