const SUPABASE_URL='https://istmdoxhjyardqxrmvcq.supabase.co';
const SUPABASE_KEY='sb_publishable_7neuuaMH2JC4k3d2hA59lw_UcWlNvSO';

async function sb(path,opts={}){
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    ...opts,
    headers:{
      'apikey':SUPABASE_KEY,
      'Authorization':`Bearer ${SUPABASE_KEY}`,
      'Content-Type':'application/json',
      ...(opts.headers||{})
    }
  });
  if(!res.ok){
    const errText=await res.text().catch(()=>'');
    console.error('Supabase error',res.status,errText);
    throw new Error('Supabase request failed: '+res.status);
  }
  const text=await res.text();
  return text?JSON.parse(text):null;
}

let roster={officials:[],positions:[]};
let games=[];
let positionIdByName={};
let currentAvailUser=null, currentAdminUser=null;
let backendUnavailable=false;

async function loadAll(){
  const [officialRows,positionRows,gameRows] = await Promise.all([
    sb('officials?select=*&order=name.asc'),
    sb('positions?select=*&order=sort_order.asc'),
    sb('games?select=*&order=game_date.asc,game_time.asc')
  ]);
  roster.officials = officialRows.map(o=>({id:o.id,name:o.name,pin:o.pin,role:o.role,skills:o.skills||[],hidden:!!o.hidden}));
  roster.positions = positionRows.map(p=>p.name);
  positionIdByName = {};
  positionRows.forEach(p=>positionIdByName[p.name]=p.id);
  games = gameRows.map(g=>({id:g.id,date:g.game_date,time:(g.game_time||'19:00').slice(0,5),opponent:g.opponent||''}));
}

async function fetchGameData(gameId){
  const [availRows,assignRows] = await Promise.all([
    sb(`availability?game_id=eq.${gameId}&select=official_id,status`),
    sb(`assignments?game_id=eq.${gameId}&select=position_name,official_id,updated_at,updated_by`)
  ]);
  const availability={}; availRows.forEach(r=>availability[r.official_id]=r.status);
  const assignments={}; assignRows.forEach(r=>assignments[r.position_name]=r.official_id);
  let lastUpdated=null;
  assignRows.forEach(r=>{
    if(r.updated_at && (!lastUpdated || new Date(r.updated_at) > new Date(lastUpdated.at))){
      lastUpdated = {at:r.updated_at, by:r.updated_by};
    }
  });
  return {availability,assignments,lastUpdated};
}

async function refreshAll(){
  await loadAll();
}

async function init(){
  try{
    await loadAll();
  }catch(e){
    backendUnavailable=true;
    document.body.insertAdjacentHTML('afterbegin', `<div style="background:#E14B3E;color:#fff;text-align:center;padding:10px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;">
      ⚠️ Can't reach the database right now — check your internet connection and reload. Nothing will save until this is resolved.
    </div>`);
  }

  renderScoreboard();
  renderPublicSchedule();
  populateLoginSelects();
  renderAdminGamesList();
  renderAdminRoster();
  renderAdminPositions();
  populateAssignGameSelect();
}

function sortedGames(){ return [...games].sort((a,b)=> new Date(a.date+'T'+(a.time||'00:00')) - new Date(b.date+'T'+(b.time||'00:00'))); }
function nextHomeGame(){
  const now=new Date();
  return sortedGames().find(g=> new Date(g.date+'T'+(g.time||'00:00')) >= now);
}

function renderScoreboard(){
  const board=document.getElementById('scoreboard');
  const ng=nextHomeGame();
  const officialCount=crewOfficials().length;
  board.innerHTML = `
    <div class="cell"><div class="label">Next Home Game</div><div class="value">${ng? fmtDate(ng.date)+' · '+ng.time : '— none scheduled —'}</div></div>
    <div class="cell"><div class="label">Opponent</div><div class="value">${ng? esc(ng.opponent||'TBD') : '—'}</div></div>
    <div class="cell"><div class="label">Puck Drop In</div><div class="value ember" id="countdown-value">--</div></div>
    <div class="cell"><div class="label">Officials on Roster</div><div class="value">${officialCount}</div></div>
    <div class="cell"><div class="label">Open Positions</div><div class="value">${roster.positions.length}</div></div>
  `;
  tickCountdown();
}
function tickCountdown(){
  const el=document.getElementById('countdown-value');
  if(!el) return;
  const ng=nextHomeGame();
  if(!ng){ el.textContent='—'; return; }
  const target=new Date(ng.date+'T'+(ng.time||'00:00'));
  const diff=target-new Date();
  if(diff<=0){ el.textContent='Puck drop!'; return; }
  const d=Math.floor(diff/86400000);
  const h=Math.floor((diff%86400000)/3600000);
  const m=Math.floor((diff%3600000)/60000);
  const s=Math.floor((diff%60000)/1000);
  el.textContent = `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
}
setInterval(tickCountdown,1000);

const TEAM_COLORS={
  'Toronto Marlies':{abbr:'TOR',color:'#00285E'},
  'Rochester Americans':{abbr:'ROC',color:'#003876'},
  'Syracuse Crunch':{abbr:'SYR',color:'#002868'},
  'Hartford Wolf Pack':{abbr:'HFD',color:'#0038A8'},
  'Providence Bruins':{abbr:'PRO',color:'#FFB81C'},
  'Lehigh Valley Phantoms':{abbr:'LV',color:'#F74902'},
  'Belleville Senators':{abbr:'BEL',color:'#C52032'},
  'Laval Rocket':{abbr:'LAV',color:'#AF1E2D'},
  'Utica Comets':{abbr:'UTI',color:'#CE1126'},
  'Cleveland Monsters':{abbr:'CLE',color:'#002654'},
  'Abbotsford Canucks':{abbr:'ABB',color:'#00205B'},
  'Springfield Thunderbirds':{abbr:'SPR',color:'#003087'},
  'Grand Rapids Griffins':{abbr:'GR',color:'#CE1126'},
  'Hershey Bears':{abbr:'HER',color:'#5C3A21'},
  'Wilkes-Barre Scranton Penguins':{abbr:'WBS',color:'#231F20'}
};
function teamBadge(name){
  if(!name) return '';
  const t=TEAM_COLORS[name];
  const color=t?t.color:'#4A5568';
  const abbr=t?t.abbr:name.split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase();
  return `<span class="team-badge" style="background:${color}">${esc(abbr)}</span>`;
}
function fmtDate(d){
  const dt=new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
}
function monthLabel(d){
  const dt=new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-CA',{month:'long',year:'numeric'});
}
function esc(s){ return (s||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
function nameById(id){ const o=roster.officials.find(x=>x.id===id); return o? o.name : null; }
function initials(name){
  if(!name) return '?';
  const parts=name.trim().split(/\s+/);
  if(parts.length>=2) return (parts[0][0]+parts[1][0]).toUpperCase();
  return name.slice(0,2).toUpperCase();
}
function lastUpdatedLine(lastUpdated){
  if(!lastUpdated || !lastUpdated.at) return null;
  const dt=new Date(lastUpdated.at);
  const when=dt.toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const who=lastUpdated.by ? initials(nameById(lastUpdated.by)) : '?';
  return `Last updated ${when} · ${esc(who)}`;
}
function crewOfficials(){ return roster.officials.filter(o=>!o.hidden); }

/* ---------------- PUBLIC SCHEDULE ---------------- */
async function renderPublicSchedule(){
  const el=document.getElementById('public-schedule');
  const list=sortedGames();
  if(!list.length){ el.innerHTML='<div class="empty">No games scheduled yet.</div>'; return; }

  const ng=nextHomeGame();
  const nextMonthKey = ng ? ng.date.slice(0,7) : null;

  const months=[];
  for(const g of list){
    const monthKey = g.date.slice(0,7);
    let group = months.find(m=>m.key===monthKey);
    if(!group){ group={key:monthKey,label:monthLabel(g.date),games:[]}; months.push(group); }
    group.games.push(g);
  }

  let html='';
  for(const m of months){
    let inner='';
    for(const g of m.games){
      const data = await fetchGameData(g.id);
      const available=[], unavailable=[];
      for(const o of crewOfficials()){
        const status = data.availability[o.id];
        if(status==='yes') available.push(o.name);
        else if(status==='no') unavailable.push(o.name);
      }
      available.sort((a,b)=>a.localeCompare(b));
      unavailable.sort((a,b)=>a.localeCompare(b));
      inner += `<div class="game-block">
        <div class="game-head">
          <div class="game-title">${teamBadge(g.opponent)}vs ${esc(g.opponent||'TBD')}</div>
          <div class="game-date mono">${fmtDate(g.date)} · ${g.time||''}</div>
        </div>
        <table><thead><tr><th>Position</th><th>Assigned</th></tr></thead><tbody>
        ${roster.positions.map(p=>{
          const name = nameById(data.assignments[p]);
          return `<tr><td>${esc(p)}</td><td class="${name?'name':'unassigned'}">${name?esc(name):'Unassigned'}</td></tr>`;
        }).join('')}
        </tbody></table>
        ${lastUpdatedLine(data.lastUpdated) ? `<div class="last-updated">${lastUpdatedLine(data.lastUpdated)}</div>` : ''}
        <div class="avail-summary">
          <div class="avail-col">
            <div class="avail-col-head yes">Available (${available.length})</div>
            <div class="avail-names">${available.length? available.map(esc).join(', ') : '<span class="muted">No one yet</span>'}</div>
          </div>
          <div class="avail-col">
            <div class="avail-col-head no">Not Available (${unavailable.length})</div>
            <div class="avail-names">${unavailable.length? unavailable.map(esc).join(', ') : '<span class="muted">No one yet</span>'}</div>
          </div>
        </div>
      </div>`;
    }
    const isOpen = nextMonthKey ? m.key===nextMonthKey : m===months[0];
    html += `<details class="month-group" ${isOpen?'open':''}>
      <summary>${m.label} <span class="muted">(${m.games.length} game${m.games.length>1?'s':''})</span></summary>
      <div class="month-body">${inner}</div>
    </details>`;
  }
  el.innerHTML=html;
}

/* ---------------- LOGIN SELECTS ---------------- */
function populateLoginSelects(){
  const officials = crewOfficials().sort((a,b)=>a.name.localeCompare(b.name));
  const admins = roster.officials.filter(o=>o.role==='admin').sort((a,b)=>a.name.localeCompare(b.name));
  document.getElementById('avail-name').innerHTML = officials.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('') || '<option>No officials yet — ask an admin</option>';
  document.getElementById('admin-name').innerHTML = admins.map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('') || '<option>No admins yet</option>';
}

/* ---------------- AVAILABILITY VIEW ---------------- */
document.getElementById('avail-login-btn').onclick = async ()=>{
  await refreshAll();
  const id=document.getElementById('avail-name').value;
  const pin=document.getElementById('avail-pin').value.trim();
  const o=roster.officials.find(x=>x.id===id);
  const msg=document.getElementById('avail-login-msg');
  if(!o || o.pin!==pin){ msg.textContent='Incorrect PIN.'; msg.className='status-msg bad'; return; }
  msg.textContent=''; currentAvailUser=o;
  document.getElementById('avail-login').style.display='none';
  document.getElementById('avail-app').style.display='block';
  document.getElementById('avail-whoami').innerHTML = `${esc(o.name)} <span class="tag ${o.role==='admin'?'admin':'yes'}">${o.role==='admin'?'Admin':'Official'}</span>`;
  document.getElementById('nav-admin-btn').style.display = (o.role==='admin') ? '' : 'none';
  if(o.role==='admin'){
    currentAdminUser=o;
    document.getElementById('admin-login').style.display='none';
    document.getElementById('admin-app').style.display='block';
    document.getElementById('admin-whoami').innerHTML=`${esc(o.name)} <span class="tag admin">Admin</span>`;
    populateAssignGameSelect();
  }
  if(o.role!=='admin' && document.getElementById('view-admin').classList.contains('active')){
    document.querySelector('nav button[data-view="schedule"]').click();
  }
  await renderAvailGames();
};
document.getElementById('avail-logout').onclick=()=>{
  currentAvailUser=null; currentAdminUser=null;
  document.getElementById('avail-login').style.display='block';
  document.getElementById('avail-app').style.display='none';
  document.getElementById('avail-pin').value='';
  document.getElementById('admin-login').style.display='block';
  document.getElementById('admin-app').style.display='none';
  document.getElementById('admin-pin').value='';
  document.getElementById('nav-admin-btn').style.display='none';
};

async function renderAvailGames(){
  const el=document.getElementById('avail-games');
  const upcoming = sortedGames().filter(g=> new Date(g.date+'T'+(g.time||'00:00')) >= new Date());
  if(!upcoming.length){ el.innerHTML='<div class="empty">No upcoming games scheduled.</div>'; return; }

  const months=[];
  for(const g of upcoming){
    const monthKey = g.date.slice(0,7);
    let group = months.find(m=>m.key===monthKey);
    if(!group){ group={key:monthKey,label:monthLabel(g.date),games:[]}; months.push(group); }
    group.games.push(g);
  }

  let html='';
  for(let i=0;i<months.length;i++){
    const m=months[i];
    let inner='';
    let submitted=0;
    for(const g of m.games){
      const data = await fetchGameData(g.id);
      const current = data.availability[currentAvailUser.id] || '';
      if(current) submitted++;
      inner += `<div class="game-block ${current?'':'unanswered'}" data-game="${g.id}">
        <div class="game-head">
          <div class="game-title">${teamBadge(g.opponent)}vs ${esc(g.opponent||'TBD')} ${current?'':'<span class="tag no">Not Submitted</span>'}</div>
          <div class="game-date mono">${fmtDate(g.date)} · ${g.time||''}</div>
        </div>
        <div class="avail-choices">
          ${['yes','no'].map(v=>`
            <label><input type="radio" name="av-${g.id}" value="${v}" ${current===v?'checked':''}> ${v==='yes'?'Available':'Not Available'}</label>
          `).join('')}
        </div>
      </div>`;
    }
    const total=m.games.length;
    const statusClass = submitted===total ? 'complete' : (submitted===0 ? 'none' : 'partial');
    const statusLabel = submitted===total ? 'All set' : `${submitted}/${total} submitted`;
    m.submitted=submitted; m.total=total;
    html += `<details class="month-group" ${i===0?'open':''}>
      <summary>
        <span class="summary-label">${m.label} <span class="muted">(${m.games.length} game${m.games.length>1?'s':''})</span></span>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </summary>
      <div class="month-body">
        ${inner}
        <button class="btn save-month-btn" data-month="${m.key}" style="margin-top:4px;">Save Availability</button>
        <div class="status-msg" data-month-msg="${m.key}"></div>
      </div>
    </details>`;
  }
  el.innerHTML=html;
  document.querySelectorAll('.save-month-btn').forEach(btn=>{
    btn.onclick=()=>saveAvailability(btn.dataset.month);
  });
}

async function saveAvailability(monthKey){
  const monthGroup = [...document.querySelectorAll('.month-group')].find(d=>d.querySelector(`.save-month-btn[data-month="${monthKey}"]`));
  const blocks = monthGroup.querySelectorAll('.game-block');
  let submitted=0;
  for(const b of blocks){
    const gameId=b.dataset.game;
    const checked=b.querySelector('input[type=radio]:checked');
    const titleEl = b.querySelector('.game-title');
    const baseTitle = titleEl.textContent.replace('Not Submitted','').trim();
    if(!checked){
      b.classList.add('unanswered');
      titleEl.innerHTML = `${esc(baseTitle)} <span class="tag no">Not Submitted</span>`;
      continue;
    }
    submitted++;
    b.classList.remove('unanswered');
    titleEl.textContent = baseTitle;
    await sb('availability?on_conflict=game_id,official_id',{
      method:'POST',
      headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify([{game_id:gameId,official_id:currentAvailUser.id,status:checked.value}])
    });
  }
  const total=blocks.length;
  const badge=monthGroup.querySelector('.status-badge');
  badge.className = `status-badge ${submitted===total?'complete':(submitted===0?'none':'partial')}`;
  badge.textContent = submitted===total ? 'All set' : `${submitted}/${total} submitted`;
  const msg=monthGroup.querySelector(`[data-month-msg="${monthKey}"]`);
  msg.textContent = submitted===total ? 'Saved — all games in this month answered.' : `Saved — ${total-submitted} game${total-submitted>1?'s':''} still need a response (highlighted below).`;
  msg.className='status-msg ' + (submitted===total ? 'ok' : 'bad');
  renderPublicSchedule();
}

/* ---------------- ADMIN VIEW ---------------- */
document.getElementById('admin-login-btn').onclick=async ()=>{
  await refreshAll();
  const id=document.getElementById('admin-name').value;
  const pin=document.getElementById('admin-pin').value.trim();
  const o=roster.officials.find(x=>x.id===id && x.role==='admin');
  const msg=document.getElementById('admin-login-msg');
  if(!o || o.pin!==pin){ msg.textContent='Incorrect PIN.'; msg.className='status-msg bad'; return; }
  msg.textContent=''; currentAdminUser=o;
  document.getElementById('admin-login').style.display='none';
  document.getElementById('admin-app').style.display='block';
  document.getElementById('admin-whoami').innerHTML=`${esc(o.name)} <span class="tag admin">Admin</span>`;
  document.getElementById('nav-admin-btn').style.display='';
  currentAvailUser=o;
  document.getElementById('avail-login').style.display='none';
  document.getElementById('avail-app').style.display='block';
  document.getElementById('avail-whoami').innerHTML = `${esc(o.name)} <span class="tag admin">Admin</span>`;
  populateAssignGameSelect();
};
document.getElementById('admin-logout').onclick=()=>{
  currentAdminUser=null; currentAvailUser=null;
  document.getElementById('admin-login').style.display='block';
  document.getElementById('admin-app').style.display='none';
  document.getElementById('admin-pin').value='';
  document.getElementById('avail-login').style.display='block';
  document.getElementById('avail-app').style.display='none';
  document.getElementById('avail-pin').value='';
  document.getElementById('nav-admin-btn').style.display='none';
  document.querySelector('nav button[data-view="schedule"]').click();
};
document.getElementById('staff-login-link').onclick=()=>{
  document.getElementById('nav-admin-btn').click();
};

/* -- games mgmt -- */
function renderAdminGamesList(){
  const el=document.getElementById('admin-games-list');
  const list=sortedGames();
  if(!list.length){ el.innerHTML='<div class="empty">No games yet.</div>'; return; }
  el.innerHTML=list.map(g=>`
    <div class="list-row" data-game="${g.id}">
      <div class="row" style="flex:1;align-items:center;">
        <input type="date" class="edit-date" value="${g.date}" style="max-width:150px;">
        <input type="time" class="edit-time" value="${g.time||''}" style="max-width:110px;">
        <input type="text" class="edit-opp" value="${esc(g.opponent||'')}" placeholder="Opponent" style="flex:1;min-width:160px;">
      </div>
      <button class="btn small" onclick="saveGameEdit('${g.id}')">Save</button>
      <button class="btn danger small" onclick="removeGame('${g.id}')">Remove</button>
    </div>`).join('');
}
async function saveGameEdit(id){
  const row=document.querySelector(`#admin-games-list .list-row[data-game="${id}"]`);
  const date=row.querySelector('.edit-date').value;
  const time=row.querySelector('.edit-time').value;
  const opponent=row.querySelector('.edit-opp').value.trim();
  if(!date){ alert('A date is required.'); return; }
  await sb(`games?id=eq.${id}`,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:JSON.stringify({game_date:date,game_time:time,opponent})});
  await refreshAll();
  renderAdminGamesList(); renderPublicSchedule(); renderScoreboard(); populateAssignGameSelect();
}
document.getElementById('add-game-btn').onclick=async ()=>{
  const date=document.getElementById('new-game-date').value;
  const time=document.getElementById('new-game-time').value;
  const opp=document.getElementById('new-game-opp').value.trim();
  if(!date){ alert('Pick a date.'); return; }
  await sb('games',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify({game_date:date,game_time:time,opponent:opp})});
  await refreshAll();
  document.getElementById('new-game-opp').value='';
  renderAdminGamesList(); renderPublicSchedule(); renderScoreboard(); populateAssignGameSelect();
};
async function removeGame(id){
  if(!confirm('Remove this game and its assignments?')) return;
  await sb(`games?id=eq.${id}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
  await refreshAll();
  renderAdminGamesList(); renderPublicSchedule(); renderScoreboard(); populateAssignGameSelect();
}

/* -- roster mgmt -- */
function renderAdminRoster(){
  const el=document.getElementById('admin-roster-list');
  if(!roster.officials.length){ el.innerHTML='<div class="empty">No one on the roster yet.</div>'; return; }
  const sorted = [...roster.officials].sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=sorted.map(o=>`
    <div class="list-row" data-official="${o.id}">
      <div class="row" style="flex:1;align-items:center;">
        <input type="text" class="edit-off-name" value="${esc(o.name)}" style="min-width:140px;">
        <input type="text" class="edit-off-pin" value="${esc(o.pin)}" style="max-width:100px;">
        <select class="edit-off-role" style="max-width:120px;">
          <option value="official" ${o.role!=='admin'?'selected':''}>Official</option>
          <option value="admin" ${o.role==='admin'?'selected':''}>Admin</option>
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ice-dim);white-space:nowrap;">
          <input type="checkbox" class="edit-off-hidden" ${o.hidden?'checked':''} style="width:auto;"> Hidden from crew
        </label>
      </div>
      <button class="btn small" onclick="saveOfficialEdit('${o.id}')">Save</button>
      <button class="btn danger small" onclick="removeOfficial('${o.id}')">Remove</button>
    </div>`).join('');
}
async function saveOfficialEdit(id){
  const row=document.querySelector(`#admin-roster-list .list-row[data-official="${id}"]`);
  const name=row.querySelector('.edit-off-name').value.trim();
  const pin=row.querySelector('.edit-off-pin').value.trim();
  const role=row.querySelector('.edit-off-role').value;
  const hidden=row.querySelector('.edit-off-hidden').checked;
  if(!name || !/^\d{4,6}$/.test(pin)){ alert('Enter a name and a 4–6 digit PIN.'); return; }
  await sb(`officials?id=eq.${id}`,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:JSON.stringify({name,pin,role,hidden})});
  await refreshAll();
  renderAdminRoster(); populateLoginSelects(); renderScoreboard(); renderSkillsMatrix();
}
document.getElementById('add-off-btn').onclick=async ()=>{
  const name=document.getElementById('new-off-name').value.trim();
  const pin=document.getElementById('new-off-pin').value.trim();
  const role=document.getElementById('new-off-role').value;
  if(!name || !/^\d{4,6}$/.test(pin)){ alert('Enter a name and a 4–6 digit PIN.'); return; }
  await sb('officials',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify({name,pin,role,skills:[]})});
  await refreshAll();
  document.getElementById('new-off-name').value=''; document.getElementById('new-off-pin').value='';
  renderAdminRoster(); populateLoginSelects(); renderScoreboard(); renderSkillsMatrix();
};
async function removeOfficial(id){
  if(!confirm('Remove this person from the roster?')) return;
  await sb(`officials?id=eq.${id}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
  await refreshAll();
  renderAdminRoster(); populateLoginSelects(); renderScoreboard();
}

/* -- skills matrix -- */
async function renderSkillsMatrix(){
  const wrap=document.getElementById('skills-matrix-wrap');
  wrap.innerHTML='<div class="empty">Loading…</div>';
  await refreshAll();
  const officials=crewOfficials().sort((a,b)=>a.name.localeCompare(b.name));
  if(!officials.length){ wrap.innerHTML='<div class="empty">No officials on roster yet. Add people in the Roster / Profiles tab first.</div>'; return; }
  if(!roster.positions.length){ wrap.innerHTML='<div class="empty">Add positions first.</div>'; return; }
  let html='<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="who" style="text-align:left;">Official</th>';
  html += roster.positions.map(p=>`<th class="pos-col">${esc(p)}</th>`).join('');
  html += '</tr></thead><tbody>';
  html += officials.map(o=>{
    const skills = o.skills || [];
    return `<tr><td class="who">${esc(o.name)}${o.role==='admin'?' <span class="tag admin">Admin</span>':''}</td>` +
      roster.positions.map(p=>`<td><input type="checkbox" ${skills.includes(p)?'checked':''} onchange="toggleSkill('${o.id}','${p.replace(/'/g,"\\'")}',this.checked)"></td>`).join('') +
      `</tr>`;
  }).join('');
  html += '</tbody></table></div><div class="muted" style="margin-top:10px;">Unchecked = not qualified for that position, so they won\'t appear in its Assignments dropdown.</div>';
  wrap.innerHTML=html;
}
async function toggleSkill(officialId,position,checked){
  const o=roster.officials.find(x=>x.id===officialId);
  if(!o) return;
  if(!o.skills) o.skills = [];
  if(checked){ if(!o.skills.includes(position)) o.skills.push(position); }
  else { o.skills = o.skills.filter(p=>p!==position); }
  await sb(`officials?id=eq.${officialId}`,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:JSON.stringify({skills:o.skills})});
}

/* -- positions mgmt -- */
function renderAdminPositions(){
  const el=document.getElementById('admin-positions-list');
  el.innerHTML=roster.positions.map(p=>`
    <div class="pos-edit-row">
      <input type="text" value="${esc(p)}" onchange="renamePosition('${esc(p).replace(/'/g,"\\'")}',this.value)">
      <button class="btn danger small" onclick="removePosition('${esc(p).replace(/'/g,"\\'")}')">Remove</button>
    </div>`).join('');
}
document.getElementById('add-pos-btn').onclick=async ()=>{
  const val=document.getElementById('new-pos-name').value.trim().toUpperCase();
  if(!val) return;
  await sb('positions',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify({name:val,sort_order:roster.positions.length+1})});
  await refreshAll();
  document.getElementById('new-pos-name').value='';
  renderAdminPositions(); renderPublicSchedule(); renderScoreboard(); populateAssignGameSelect(); renderSkillsMatrix();
};
async function renamePosition(oldName,val){
  const newName=val.trim().toUpperCase();
  if(!newName){ renderAdminPositions(); return; }
  const id=positionIdByName[oldName];
  await sb(`positions?id=eq.${id}`,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:JSON.stringify({name:newName})});
  await refreshAll();
  renderPublicSchedule(); populateAssignGameSelect();
}
async function removePosition(name){
  if(!confirm('Remove this position?')) return;
  const id=positionIdByName[name];
  await sb(`positions?id=eq.${id}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
  await refreshAll();
  renderAdminPositions(); renderPublicSchedule(); renderScoreboard(); populateAssignGameSelect();
}

/* -- assignments -- */
function populateAssignGameSelect(){
  const sel=document.getElementById('assign-game-select');
  const list=sortedGames();
  sel.innerHTML = list.map(g=>`<option value="${g.id}">${fmtDate(g.date)} · vs ${esc(g.opponent||'TBD')}</option>`).join('') || '<option>No games yet</option>';
  if(list.length) renderAssignBody(list[0].id);
  sel.onchange=()=>renderAssignBody(sel.value);
}
let assignEligibleByPos = {};
let assignAvailabilityMap = {};

async function renderAssignBody(gameId){
  const body=document.getElementById('assign-body');
  if(!gameId){ body.innerHTML='<div class="empty">Add a game first.</div>'; return; }
  const data = await fetchGameData(gameId);
  const officials = crewOfficials().sort((a,b)=>a.name.localeCompare(b.name));
  const availLabel = id => ({yes:'<span class="tag yes">Available</span>',no:'<span class="tag no">Not Available</span>'}[data.availability[id]] || '<span class="muted">No response</span>');

  assignAvailabilityMap = data.availability;
  assignEligibleByPos = {};
  roster.positions.forEach(p=>{
    let eligible = officials.filter(o=> data.availability[o.id]!=='no' && (o.skills||[]).includes(p));
    const currentPick = data.assignments[p];
    if(currentPick && !eligible.some(o=>o.id===currentPick)){
      const forced = officials.find(o=>o.id===currentPick);
      if(forced) eligible = [...eligible, {...forced, forced:true}];
    }
    assignEligibleByPos[p] = eligible;
  });

  let html = lastUpdatedLine(data.lastUpdated) ? `<div class="last-updated" style="margin-bottom:12px;">${lastUpdatedLine(data.lastUpdated)}</div>` : '';
  html += `<table><thead><tr><th>Official</th><th>Availability</th></tr></thead><tbody>`;
  html += officials.map(o=>`<tr><td class="name">${esc(o.name)}${o.role==='admin'?' <span class="tag admin">Admin</span>':''}</td><td>${availLabel(o.id)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No officials on roster yet.</td></tr>';
  html += `</tbody></table><table style="margin-top:14px;"><thead><tr><th>Position</th><th>Assign</th></tr></thead><tbody>`;
  html += roster.positions.map(p=>{
    const currentPick = data.assignments[p] || '';
    return `<tr><td>${esc(p)}</td><td><select class="assign-select" data-pos="${esc(p)}">${buildAssignOptions(p,currentPick)}</select></td></tr>`;
  }).join('');
  html += `</tbody></table>`;
  body.innerHTML=html;
  body.dataset.game=gameId;

  body.querySelectorAll('select.assign-select').forEach(sel=>{
    sel.addEventListener('change', refreshAssignDropdowns);
  });
  refreshAssignDropdowns();
}

function buildAssignOptions(pos,currentValue){
  const eligible = assignEligibleByPos[pos] || [];
  const opts = eligible.map(o=>{
    const mark = assignAvailabilityMap[o.id]==='yes' ? ' ✓' : '';
    const forced = o.forced ? ' (not eligible)' : '';
    return `<option value="${o.id}" ${o.id===currentValue?'selected':''}>${esc(o.name)}${mark}${forced}</option>`;
  }).join('');
  return `<option value="">— Unassigned —</option>${opts}`;
}

function refreshAssignDropdowns(){
  const body=document.getElementById('assign-body');
  const selects=[...body.querySelectorAll('select.assign-select')];
  const picks={};
  selects.forEach(sel=>{ if(sel.value) picks[sel.dataset.pos]=sel.value; });

  selects.forEach(sel=>{
    const pos=sel.dataset.pos;
    const currentValue = sel.value;
    const eligible = assignEligibleByPos[pos] || [];
    const filtered = eligible.filter(o=>{
      if(o.id===currentValue) return true;
      const otherPositions = Object.entries(picks).filter(([p,id])=> p!==pos && id===o.id).map(([p])=>p);
      if(otherPositions.length===0) return true;
      if(otherPositions.length===1 && (otherPositions[0]==='CREW CHIEF' || pos==='CREW CHIEF')) return true;
      return false;
    });
    const opts = filtered.map(o=>{
      const mark = assignAvailabilityMap[o.id]==='yes' ? ' ✓' : '';
      const forced = o.forced ? ' (not eligible)' : '';
      return `<option value="${o.id}" ${o.id===currentValue?'selected':''}>${esc(o.name)}${mark}${forced}</option>`;
    }).join('');
    sel.innerHTML = `<option value="">— Unassigned —</option>${opts}`;
    sel.value = currentValue;
    sel.dataset.current = currentValue;
  });
}
document.getElementById('save-assign-btn').onclick=async ()=>{
  const body=document.getElementById('assign-body');
  const gameId=body.dataset.game;
  if(!gameId) return;
  const msg=document.getElementById('assign-msg');

  const draft={};
  body.querySelectorAll('select.assign-select').forEach(sel=>{
    const pos=sel.dataset.pos;
    if(sel.value) draft[pos]=sel.value;
  });

  const byOfficial={};
  Object.entries(draft).forEach(([pos,offId])=>{
    (byOfficial[offId]=byOfficial[offId]||[]).push(pos);
  });
  const conflicts=[];
  Object.entries(byOfficial).forEach(([offId,positions])=>{
    if(positions.length<=1) return;
    const hasCrewChief = positions.includes('CREW CHIEF');
    if(!hasCrewChief || positions.length>2){
      conflicts.push(`${nameById(offId)||'Unknown'}: ${positions.join(' + ')}`);
    }
  });
  if(conflicts.length){
    msg.innerHTML = `Can't save — double-booked (only Crew Chief may be paired with one other position):<br>${conflicts.map(esc).join('<br>')}`;
    msg.className='status-msg bad';
    return;
  }

  await sb(`assignments?game_id=eq.${gameId}`,{method:'DELETE',headers:{'Prefer':'return=minimal'}});
  const rows = Object.entries(draft).map(([position_name,official_id])=>({game_id:gameId,position_name,official_id,updated_by:currentAdminUser.id}));
  if(rows.length){
    await sb('assignments',{method:'POST',headers:{'Prefer':'return=minimal'},body:JSON.stringify(rows)});
  }
  msg.textContent='Assignments saved.'; msg.className='status-msg ok';
  renderPublicSchedule();
  renderAssignBody(gameId);
};

/* ---------------- ADMIN SUB-NAV ---------------- */
document.querySelectorAll('.subnav button').forEach(btn=>{
  btn.onclick=async ()=>{
    document.querySelectorAll('.subnav button').forEach(b=>b.classList.remove('sub-active'));
    document.querySelectorAll('.subview').forEach(v=>v.classList.remove('sub-active'));
    btn.classList.add('sub-active');
    document.getElementById('sub-'+btn.dataset.sub).classList.add('sub-active');
    await refreshAll();
    if(btn.dataset.sub==='skills') renderSkillsMatrix();
    if(btn.dataset.sub==='games') renderAdminGamesList();
    if(btn.dataset.sub==='assign') populateAssignGameSelect();
    if(btn.dataset.sub==='roster') renderAdminRoster();
    if(btn.dataset.sub==='positions') renderAdminPositions();
  };
});

/* ---------------- NAV ---------------- */
document.querySelectorAll('nav button').forEach(btn=>{
  btn.onclick=async ()=>{
    document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    await refreshAll();
    if(btn.dataset.view==='schedule') renderPublicSchedule();
    if(btn.dataset.view==='availability' && currentAvailUser) renderAvailGames();
    if(btn.dataset.view==='admin' && currentAdminUser){
      renderAdminGamesList(); renderAdminRoster(); renderAdminPositions(); populateAssignGameSelect();
    }
    if(!currentAvailUser && !currentAdminUser) populateLoginSelects();
  };
});

init();
