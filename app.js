'use strict';

let WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let socket = null;
let S = null;
let MY_CLIENT_ID = null;
let PLAYERS = null;
let TRAIT_DEFS = { freekick:'🎯', penalty:'⚽', header:'💪' };
let audioCtx = null;

const POS_ORDER = ['GK','RB','CB','LB','CDM','CAM','RW','LW','ST'];
const POS_LABEL = {GK:'🧤 Kaleci',RB:'🛡️ Sağ Bek',CB:'🧱 Stoper',LB:'🛡️ Sol Bek',
  CDM:'🪫 Defansif Orta Saha',CAM:'🎯 Ofansif Orta Saha',RW:'⚡ Sağ Kanat',LW:'⚡ Sol Kanat',ST:'⚽ Forvet'};
const BUDGET = 70;
const MAX_TEAMS = 6;
let toastTimer = null;

function connect() {
  socket = new WebSocket(WS_URL);
  socket.onopen = () => console.log('WebSocket bağlandı');
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'init') {
      MY_CLIENT_ID = msg.clientId;
      if (msg.players) PLAYERS = msg.players;
      if (msg.traitDefs) TRAIT_DEFS = msg.traitDefs;
    } else if (msg.type === 'state') {
      S = msg.state;
      render();
    } else if (msg.type === 'error') {
      toast(msg.message);
    }
  };
  socket.onclose = () => {
    console.log('WebSocket kapandı, yeniden bağlanılıyor...');
    setTimeout(connect, 2000);
  };
  socket.onerror = (err) => console.error('WebSocket hatası:', err);
}

function send(action, payload = {}) {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ action, payload }));
  } else {
    toast('Bağlantı yok, lütfen bekleyin...');
  }
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const getTeam = id => S.teams.find(t => t.id === id);
const tname = id => { const t = getTeam(id); return t ? t.name : '?'; };
function initials(n){ return (n||'').trim().split(/\s+/).map(w => w[0]||'').join('').slice(0,2).toUpperCase(); }
function getPosGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (['RB','CB','LB'].includes(pos)) return 'DEF';
  if (['CDM','CAM'].includes(pos)) return 'MID';
  return 'FWD';
}
const byId = id => (PLAYERS ? PLAYERS[id] : null);

function initAudio() {
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function standingsRows() {
  return Object.values(S.standings).sort((x,y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    const gdx = x.gf - x.ga, gdy = y.gf - y.ga;
    if (gdy !== gdx) return gdy - gdx;
    return y.gf - x.gf;
  });
}

function render() {
  if (!S) return;
  try {
    switch (S.screen) {
      case 'home': return renderHome();
      case 'create': return renderCreate();
      case 'join': return renderJoin();
      case 'lobby': return renderLobby();
      case 'draft': return renderDraft();
      case 'ready': return renderReady();
      case 'draw': return renderDraw();
      case 'league': return renderLeague();
      case 'leagueEnd': return renderLeagueEnd();
      case 'ucl': return renderUcl();
      case 'trophy': return renderTrophy();
      case 'end': return renderEnd();
      default: return renderHome();
    }
  } catch (e) {
    console.error(e);
    document.getElementById('app').innerHTML = '<div class="card center" style="color:#ff8080;margin-top:20px;padding:20px"><b>Bir hata oluştu:</b><br>' + esc(e.message) + '<br><br><button class="btn secondary" onclick="location.reload()">Yenile</button></div>';
  }
}

function renderHome() {
  document.getElementById('app').innerHTML = `
    <div class="title">Sosyal Halı Saha</div>
    <div class="hero">⚽</div>
    <div class="sub">Takımını kur, gücünü göster ve şampiyonluğa uzan!</div>
    <button class="btn primary" onclick="initAudio(); send('navigate',{screen:'create'})">🏟️ Halı Saha Takımı Kur</button>
    <button class="btn secondary" onclick="initAudio(); send('navigate',{screen:'join'})">🤝 Halı Sahaya Katıl</button>
    <div class="hint" style="text-align:center;margin-top:14px">💡 Tek başına oynamak için takımını kurduktan sonra lobide <b>🤖 Bot Takım Ekle</b> butonunu kullan.</div>
  `;
}

function renderCreate() {
  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">🏟️ Halı Saha Takımı Kur</div><div class="sh-sub">Takımını oluştur ve 5 haneli oda kodunu al</div></div>
    <div class="card">
      <label>Takım Adı</label>
      <input id="tname" maxlength="22" placeholder="Örn: Yeşil Sahalar SK" autocomplete="off">
      <label>Teknik Direktör Adı</label>
      <input id="cname" maxlength="22" placeholder="Örn: Ahmet Yılmaz" autocomplete="off">
      <div style="height:16px"></div>
      <button class="btn primary" onclick="createTeam()">🔑 Kod Al</button>
    </div>
    <button class="btn ghost" onclick="send('navigate',{screen:'home'})">← Geri</button>
  `;
}

function createTeam() {
  const tn = document.getElementById('tname').value.trim();
  const cn = document.getElementById('cname').value.trim();
  if (tn.length < 2) return toast('Takım adı en az 2 karakter olmalı');
  if (cn.length < 2) return toast('Teknik direktör adı gerekli');
  send('createTeam', { name: tn, coach: cn });
}

function renderJoin() {
  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">🤝 Halı Sahaya Katıl</div><div class="sh-sub">Oda kodunu gir ve takımını sahaya sür</div></div>
    <div class="card">
      <label>Oda Kodu (5 hane)</label>
      <input id="jcode" maxlength="5" inputmode="numeric" placeholder="Örn: 48213" autocomplete="off">
      <label>Takım Adı</label>
      <input id="jtname" maxlength="22" placeholder="Örn: Gece Kuşları FK" autocomplete="off">
      <label>Teknik Direktör Adı</label>
      <input id="jcname" maxlength="22" placeholder="Örn: Mehmet Demir" autocomplete="off">
      <div style="height:16px"></div>
      <button class="btn primary" onclick="joinTeam()">✅ Katıl</button>
    </div>
    <div class="hint" style="text-align:center;margin-bottom:12px">Oda kodu, takım kurduktan sonra lobide gösterilir.</div>
    <button class="btn ghost" onclick="send('navigate',{screen:'home'})">← Geri</button>
  `;
}

function joinTeam() {
  const code = document.getElementById('jcode').value.trim();
  const tn = document.getElementById('jtname').value.trim();
  const cn = document.getElementById('jcname').value.trim();
  if (!code) return toast('Oda kodu gerekli');
  if (tn.length < 2) return toast('Takım adı en az 2 karakter olmalı');
  if (cn.length < 2) return toast('Teknik direktör adı gerekli');
  send('joinTeam', { code, name: tn, coach: cn });
}

function addBot(){ send('addBot'); }
function removeTeam(id){ send('removeTeam', { id }); }
function startDraft(){ send('startDraft'); }
function leaveRoom(){ send('leaveRoom'); }

function renderLobby() {
  const isHost = MY_CLIENT_ID === S.hostClientId;
  let teamsHTML = '';
  
  S.teams.forEach(t => {
    const removeBtn = (isHost && t.isBot) ? `<button class="mini-btn" onclick="removeTeam('${t.id}')">✕</button>` : '';
    const botTag = t.isBot ? '<span class="bot-tag">BOT</span>' : '';
    const badgeCls = t.isBot ? 'team-badge bot' : 'team-badge';
    const myTag = t.clientId === MY_CLIENT_ID ? ' (Sen)' : '';
    
    teamsHTML += `
      <div class="team-row">
        <div class="team-info">
          <div class="${badgeCls}">${initials(t.name)}</div>
          <div style="flex:1;min-width:0">
            <div class="team-name">${esc(t.name)}${botTag}${myTag}</div>
            <div class="team-sub">TD: ${esc(t.coach)}</div>
          </div>
          ${removeBtn}
        </div>
      </div>`;
  });

  const canStart = S.teams.length >= 2;
  const botBtnState = (S.teams.length >= MAX_TEAMS || !isHost) ? 'disabled' : '';
  const startBtnState = (!canStart || !isHost) ? 'disabled' : '';
  const startBtnText = isHost ? (canStart ? '⚽ Kadro Seçimine Başla' : 'En az 2 takım gerekli') : 'Kurucunun başlatması bekleniyor...';

  let hostControls = '';
  if (isHost) {
    hostControls = `
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn secondary" onclick="addBot()" ${botBtnState}>🤖 Bot Takım Ekle</button>
      </div>
      <button class="btn gold" onclick="startDraft()" ${startBtnState}>${startBtnText}</button>
    `;
  } else {
    hostControls = `
      <div class="card center" style="padding:20px;background:rgba(0,0,0,0.2)">
        <div class="spinner" style="font-size:24px;margin-bottom:10px">⏳</div>
        <div style="color:#f5c542;font-weight:800">Oda Kurucusunun İşlem Yapması Bekleniyor...</div>
      </div>
    `;
  }

  document.getElementById('app').innerHTML = `
    <div class="title">Sosyal Halı Saha</div>
    <div class="card code-card">
      <div class="code-label">ODA KODU</div>
      <div class="code">${S.code || '---'}</div>
      <div class="hint">Bu kodu arkadaşlarınla paylaş</div>
    </div>
    <div class="card">
      <div class="card-head">👥 Takımlar <span class="badge">${S.teams.length}/${MAX_TEAMS}</span></div>
      ${teamsHTML}
    </div>
    ${hostControls}
    <button class="btn ghost" onclick="leaveRoom()" style="margin-top:10px">← Odadan Ayrıl</button>
  `;
}

function togglePick(id){ send('togglePick', { id }); }
function autoFillCurrent(){ send('autoFillCurrent'); }
function clearDraft(){ send('clearDraft'); }
function confirmDraft(){ send('confirmDraft'); }

function renderDraft() {
  const team = S.teams[S.draftIdx];
  if (!team || !PLAYERS) return;

  if (team.isBot) {
    document.getElementById('app').innerHTML = `
      <div class="screen-head"><div class="sh-title">🤖 ${esc(team.name)}</div><div class="sh-sub">Bot kadrosunu kuruyor...</div></div>
      <div class="card"><div class="spinner">⏳</div><div class="center" style="font-size:13px">Otomatik kadro seçimi yapılıyor</div></div>
    `;
    return;
  }

  // Sıra bende değilse bekleme ekranı
  if (team.clientId !== MY_CLIENT_ID) {
    document.getElementById('app').innerHTML = `
      <div class="screen-head"><div class="sh-title">⏳ Sıran Bekleniyor</div><div class="sh-sub">${esc(team.name)} kadrosunu kuruyor</div></div>
      <div class="card center" style="padding:40px">
        <div class="spinner">⚽</div>
        <p style="margin-top:20px">Lütfen diğer oyuncunun seçimini bitirmesini bekle...</p>
      </div>
    `;
    return;
  }

  // Benim sıram
  const sel = S.draftSel.map(byId).filter(Boolean);
  const total = sel.reduce((a,p) => a + p.price, 0);
  const rem = BUDGET - total;
  const pct = Math.min(100, (total / BUDGET) * 100);
  const groupCounts = {GK:0,DEF:0,MID:0,FWD:0};
  sel.forEach(p => groupCounts[getPosGroup(p.pos)]++);
  const limits = {GK:2,DEF:3,MID:3,FWD:3};

  let groupsHTML = '';
  POS_ORDER.forEach(pos => {
    const list = PLAYERS.filter(p => p.pos === pos);
    if (!list.length) return;
    let chipsHTML = '';
    list.forEach(p => {
      const on = S.draftSel.includes(p.id);
      const grp = getPosGroup(p.pos);
      const groupFull = groupCounts[grp] >= limits[grp];
      const disabled = !on && (S.draftSel.length >= 11 || total + p.price > BUDGET || groupFull);
      let traitsHTML = '';
      if (p.traits && p.traits.length) {
        const mappedTraits = p.traits.map(t => TRAIT_DEFS[t]).join(' ');
        traitsHTML = `<div class="trait-icons">${mappedTraits}</div>`;
      }
      const btnCls = 'chip ' + (on?'on ':'') + (disabled?'disabled':'');
      const disAttr = disabled ? 'disabled' : '';
      chipsHTML += `<button class="${btnCls}" ${disAttr} onclick="togglePick(${p.id})">
        <span class="chip-top"><span>${esc(p.name)}</span><span class="chip-price">${p.price.toFixed(1)}M</span></span>
        ${traitsHTML}
      </button>`;
    });
    groupsHTML += `<div class="pool-group"><h4>${POS_LABEL[pos]}</h4><div class="chips">${chipsHTML}</div></div>`;
  });

  let selSummary = '';
  ['GK','DEF','MID','FWD'].forEach(g => {
    const names = sel.filter(p => getPosGroup(p.pos) === g).map(p => p.name);
    if (names.length) {
      selSummary += `<span class="slot" style="width:100%"><b>${g}:</b> ${names.map(esc).join(', ')}</span>`;
    }
  });
  if (!selSummary) selSummary = '<span class="slot empty" style="width:100%">Henüz oyuncu seçilmedi</span>';

  const clearBtn = S.draftSel.length ? '<button class="btn ghost" style="margin-bottom:10px" onclick="clearDraft()">🗑️ Seçimi Temizle</button>' : '';
  const barCls = pct > 85 ? 'bar warn' : 'bar';
  const compBtnTxt = sel.length === 11 ? '✅ Kadroyu Onayla' : `Kadroyu Tamamla (${sel.length}/11)`;
  const compBtnDis = sel.length !== 11 ? 'disabled' : '';

  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">📋 ${esc(team.name)}</div><div class="sh-sub">TD: ${esc(team.coach)} — Bütçe: ${BUDGET}M €</div></div>
    <div class="card">
      <div class="budget-row"><span>Kalan Bütçe: ${rem.toFixed(1)}M</span><span>${sel.length}/11 Oyuncu</span></div>
      <div class="${barCls}"><div style="width:${pct}%"></div></div>
      <div style="font-size:12px;color:#8fd8ae;margin-bottom:6px;font-weight:800">SEÇİLEN KADRO (${sel.length}/11)</div>
      <div class="slotline">${selSummary}</div>
      <div style="font-size:11px;color:#8fd8ae;margin-top:8px;">💡 İkonlar: 🎯 Frikik, ⚽ Penaltı, 💪 Hava Topu</div>
    </div>
    <div class="card">
      <div class="card-head">⚽ Oyuncu Havuzu <button class="mini-btn green" onclick="autoFillCurrent()">⚡ Oto Doldur</button></div>
      <div class="pool" id="poolScroll">${clearBtn}${groupsHTML}</div>
      <button class="btn primary" onclick="confirmDraft()" ${compBtnDis}>${compBtnTxt}</button>
    </div>
  `;

  const el = document.getElementById('poolScroll');
  if (el) {
    el.scrollTop = S._poolScroll || 0;
    el.addEventListener('scroll', () => { send('scroll', { top: el.scrollTop }); });
  }
}

function renderReady() {
  const fx = S.fixtures[S.curMatch];
  const t1 = tname(fx?.a);
  const t2 = tname(fx?.b);
  const readyCount = S.readyCount || 0;
  const totalTeams = S.teams.filter(t => !t.isBot).length;
  
  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">⚔️ Maç Başlıyor</div><div class="sh-sub">${esc(t1)} vs ${esc(t2)}</div></div>
    <div class="card center" style="padding:40px">
      <div class="spinner">⚽</div>
      <p style="margin-top:20px;font-size:18px;font-weight:800;color:#a3ffb0">Hazır mısın?</p>
      <p style="color:#8fd8ae;margin-bottom:20px">Maçın başlaması için tüm oyuncuların hazır olması bekleniyor</p>
      <div class="badge" style="font-size:16px;padding:10px 20px;margin-bottom:20px">${readyCount} / ${totalTeams} Oyuncu Hazır</div>
      ${S.myReady ? '<div class="center" style="color:#f5c542;font-weight:800">✅ Hazırsın! Diğerleri bekleniyor...</div>' 
                  : '<button class="btn gold" onclick="send(\'playerReady\')">✅ Hazırım!</button>'}
    </div>
  `;
}

function renderDraw() {
  const isHost = MY_CLIENT_ID === S.hostClientId;
  let fxHTML = '';
  S.fixtures.forEach((f) => {
    fxHTML += `<div class="fx-row"><span>${esc(tname(f.a))}</span><span class="vs">VS</span><span>${esc(tname(f.b))}</span></div>`;
  });
  
  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">🎲 Fikstür Çekildi</div><div class="sh-sub">Lig başlıyor!</div></div>
    <div class="card"><div class="card-head">📅 Maçlar</div>${fxHTML}</div>
    ${isHost 
      ? '<button class="btn gold" onclick="send(\'startLeague\')">⚽ Ligi Başlat</button>'
      : '<div class="card center" style="color:#f5c542;font-weight:800">Kurucunun ligi başlatması bekleniyor...</div>'}
  `;
}

function renderFeed() {
  if (!S.live || !S.live.events || !S.live.events.length) return '';
  let html = '<div class="feed">';
  S.live.events.slice().reverse().forEach(ev => {
    html += `<div class="feed-item"><span class="fmin">${ev.min}'</span>${esc(ev.text)}</div>`;
  });
  html += '</div>';
  return html;
}

function renderLiveCard() {
  if (!S.live) return '';
  return `
    <div class="card live-card">
      <div class="live-clock">${S.live.minute}'</div>
      <div class="live-score">
        <div class="ls-team">${esc(tname(S.live.teamA))}</div>
        <div class="ls-num">${S.live.scoreA}</div>
        <div class="ls-sep">-</div>
        <div class="ls-num">${S.live.scoreB}</div>
        <div class="ls-team">${esc(tname(S.live.teamB))}</div>
      </div>
      <div class="live-bar"><div style="width:${(S.live.minute/90)*100}%"></div></div>
      ${renderFeed()}
    </div>
  `;
}

function renderLeague() {
  const liveHTML = renderLiveCard();
  let lastHTML = '';
  if (S.lastResult && !S.live) {
    lastHTML = `
      <div class="card">
        <div class="card-head">📋 Son Maç</div>
        <div class="fx-row">
          <span>${esc(tname(S.lastResult.a))}</span>
          <span class="vs">${S.lastResult.scoreA} - ${S.lastResult.scoreB}</span>
          <span>${esc(tname(S.lastResult.b))}</span>
        </div>
      </div>
    `;
  }

  let fxHTML = '';
  S.fixtures.forEach((f, i) => {
    const isPlayed = i < S.curMatch;
    const isLive = (i === S.curMatch) && S.live;
    const prefix = isLive ? '▶ ' : (isPlayed ? '✓ ' : '');
    const score = isPlayed ? `${f.scoreA} - ${f.scoreB}` : 'VS';
    const style = isLive ? 'background:rgba(34,197,94,0.15);' : '';
    fxHTML += `<div class="fx-row" style="${style}">
      <span>${prefix}${esc(tname(f.a))}</span>
      <span class="vs">${score}</span>
      <span>${esc(tname(f.b))}</span>
    </div>`;
  });

  const rows = standingsRows();
  let stHTML = '';
  rows.forEach((r, i) => {
    stHTML += `<div class="row">
      <span class="rank">${i+1}</span>
      <span class="rname">${esc(tname(r.id))}</span>
      <span class="rval">${r.pts}</span>
    </div>`;
  });

  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">🏆 Lig</div><div class="sh-sub">Maç ${Math.min(S.curMatch+1, S.fixtures.length)}/${S.fixtures.length}</div></div>
    ${liveHTML}
    ${lastHTML}
    <div class="card"><div class="card-head">📅 Fikstür</div>${fxHTML}</div>
    <div class="card"><div class="card-head">📊 Puan Durumu</div>${stHTML}</div>
  `;
}

function renderLeagueEnd() {
  const isHost = MY_CLIENT_ID === S.hostClientId;
  const rows = standingsRows();
  if (!rows.length) return;
  const champ = rows[0];
  const canUcl = rows.length >= 2;
  document.getElementById('app').innerHTML = `
    <div class="champ-card">
      <div class="crown">👑</div>
      <div class="champ-name">${esc(tname(champ.id))}</div>
      <div class="champ-sub">Lig Şampiyonu</div>
    </div>
    ${canUcl
      ? (isHost ? '<button class="btn gold" onclick="send(\'startUcl\')">🏆 Şampiyonlar Ligi\'ne Git</button>' 
                : '<div class="card center" style="color:#f5c542;font-weight:800">Kurucunun devam etmesi bekleniyor...</div>')
      : '<div class="hint" style="text-align:center;margin-bottom:12px">Şampiyonlar Ligi için en az 2 takım gerekir.</div>'}
    ${isHost ? '<button class="btn secondary" onclick="send(\'restart\')">🔄 Yeniden Başlat</button>' : ''}
  `;
}

function renderUcl() {
  const U = S.ucl;
  if (!U) return;
  let matchesHTML = '';
  ['sf1','sf','sf2','final'].forEach(key => {
    const m = U[key];
    if (!m) return;
    matchesHTML += `
      <div class="card">
        <div class="card-head">${m.name}</div>
        <div class="fx-row"><span>${m.a ? esc(tname(m.a)) : '?'}</span><span class="vs">VS</span><span>${m.b ? esc(tname(m.b)) : '?'}</span></div>
      </div>
    `;
  });
  document.getElementById('app').innerHTML = `
    <div class="screen-head"><div class="sh-title">🏆 Şampiyonlar Ligi</div></div>
    ${renderLiveCard()}
    ${matchesHTML}
  `;
}

function renderTrophy() {
  const isHost = MY_CLIENT_ID === S.hostClientId;
  const winner = S.uclWinner ? tname(S.uclWinner) : '?';
  document.getElementById('app').innerHTML = `
    <div class="trophy-wrap">
      <div class="trophy">🏆</div>
      <div class="trophy-title">ŞAMPİYONLAR LİGİ</div>
      <div class="trophy-name">${esc(winner)}</div>
      <div class="trophy-sub">Avrupa'nın Kralı!</div>
    </div>
    ${isHost 
      ? '<button class="btn gold" onclick="send(\'finishGame\')">🎉 Oyunu Bitir</button>'
      : '<div class="card center" style="color:#f5c542;font-weight:800">Kurucunun bitirmesi bekleniyor...</div>'}
  `;
}

function renderEnd() {
  const isHost = MY_CLIENT_ID === S.hostClientId;
  const champ = S.uclWinner || S.leagueChampion;
  const champName = champ ? tname(champ) : '?';
  document.getElementById('app').innerHTML = `
    <div class="champ-card">
      <div class="crown">🏆</div>
      <div class="champ-name">${esc(champName)}</div>
      <div class="champ-sub">Tüm sezonun şampiyonu!</div>
    </div>
    ${isHost 
      ? '<button class="btn primary" onclick="send(\'restart\')">🔄 Yeniden Oyna</button>'
      : '<div class="card center" style="color:#f5c542;font-weight:800">Kurucunun yeniden başlatması bekleniyor...</div>'}
  `;
}

function boot() {
  connect();
  document.getElementById('app').innerHTML = '<div class="center" style="padding:40px">🔌 Sunucuya bağlanılıyor...</div>';
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}