
const Q = (s,root=document)=>root.querySelector(s);
const API_DEFAULT='https://quraa-api-staging.quraaweb.workers.dev';
function apiBase(){return (localStorage.getItem('quraa_admin_api')||API_DEFAULT).replace(/\/+$/,'')}
function token(){return sessionStorage.getItem('quraa_admin_token')||''}
function headers(extra={}){const h={...extra};if(token())h.Authorization='Bearer '+token();return h}
async function api(path,opts={}){
  const h=headers(opts.headers||{});
  if(opts.body && !h['Content-Type'])h['Content-Type']='application/json';
  const r=await fetch(apiBase()+path,{...opts,headers:h});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={message:raw}}
  if(!r.ok)throw new Error(d.error||d.message||`HTTP ${r.status}`);
  return d;
}
function msg(text,kind='notice'){const box=Q('#status');if(box){box.className='notice '+(kind==='error'?'error':kind==='warn'?'warn':'');box.textContent=text;}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function nav(active){const items=[['dashboard.html','الرئيسية','dashboard'],['readers.html','القراء','readers'],['recitations.html','التلاوات','recitations'],['content.html','المحتوى','content'],['reports.html','البلاغات','reports'],['backup.html','النسخ الاحتياطي','backup'],['settings.html','الإعدادات','settings']];Q('#nav').innerHTML=items.map(([u,t,k])=>`<a href="${u}" class="${k===active?'active':''}">${t}</a>`).join('')+'<a href="login.html">الخروج / الاتصال</a>';}
function initPage(active){nav(active);if(!token()){location.href='login.html';return false;}return true;}
async function loadReaders(){const d=await api('/api/readers');return d.readers||[]}
async function loadRecitations(){const d=await api('/api/recitations');return d.recitations||[]}
