'use strict';

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

/* ==================== OYUNCU HAVUZU ==================== */
const RAW = [
  ['GK','Lev Yashin',4.5],['GK','Iker Casillas',5.0],['GK','Gianluigi Buffon',6.0],['GK','Oliver Kahn',6.0],['GK','Manuel Neuer',6.5],
  ['RB','Cafu',6.0],['RB','Dani Alves',5.5],['RB','Philipp Lahm',6.0],['RB','Trent Alexander-Arnold',6.5],
  ['CB','Franz Beckenbauer',7.0],['CB','Sergio Ramos',6.5],['CB','Virgil van Dijk',7.0],['CB','Fabio Cannavaro',6.0],
  ['LB','Roberto Carlos',6.5],['LB','Paolo Maldini',7.0],['LB','Ashley Cole',5.0],
  ['CDM','Claude Makélélé',5.0],['CDM','Roy Keane',5.0],['CDM','N\'Golo Kanté',6.0],['CDM','Sergio Busquets',6.0],
  ['CAM','Zinedine Zidane',8.0],['CAM','Kevin De Bruyne',7.5],['CAM','Kaka',7.0],['CAM','Andres Iniesta',7.5],
  ['RW','Lionel Messi',9.5],['RW','Cristiano Ronaldo',9.0],['RW','Arjen Robben',7.0],['RW','Mohamed Salah',8.0],
  ['LW','Ronaldinho',8.5],['LW','Neymar',8.0],['LW','Kylian Mbappe',8.5],['LW','Ryan Giggs',5.5],
  ['ST','Ronaldo Nazário',9.0],['ST','Pelé',9.5],['ST','Luis Suarez',8.0],['ST','Robert Lewandowski',8.5],['ST','Lefter Küçükandonyadis',5.0]
];

const PLAYER_TRAITS = {
  'Lionel Messi': ['freekick','penalty'], 'Cristiano Ronaldo': ['header','penalty'],
  'Ronaldinho': ['freekick'], 'Zinedine Zidane': ['header'], 'Kevin De Bruyne': ['freekick'],
  'Sergio Ramos': ['header'], 'Virgil van Dijk': ['header'], 'Roberto Carlos': ['freekick'],
  'Neymar': ['penalty'], 'Kylian Mbappe': ['penalty'], 'Mohamed Salah': ['penalty'], 'Robert Lewandowski': ['header','penalty']
};
const TRAIT_DEFS = { freekick:'🎯', penalty:'⚽', header:'💪' };

const PLAYERS = RAW.map((r,i)=>({ id:i, pos:r[0], name:r[1], price:r[2], traits:PLAYER_TRAITS[r[1]]||[] }));
const byId = id => PLAYERS[id];
const BUDGET = 70;
const MAX_TEAMS = 6;
const BOT_NAMES = ['Demir Pençe SK','Gece Kartalları','Sokak Ligi FK','Anadolu Yıldızı','Kuzey Rüzgarı','Çelik Kale','Yıldırım Spor','Kartal Yuvası','Beton Savunma','Fırtına FK','Sessiz Suikast','Yenilmezler SK'];
const BOT_COACHES = ['Bot Hoca','Yapay Zeka TD','Sanal Hoca','Robot TD','Dijital Hoca'];

/* ==================== ODALAR ==================== */
const rooms = new Map();

function freshRoom(code) {
  return {
    code, screen:'home', teams:[], hostId:null, hostClientId:null,
    draftIdx:0, draftSel:[], _poolScroll:0, readyCount: 0, myReady: false,
    fixtures:[], curMatch:0, live:null, lastResult:null,
    standings:{}, scorers:{},
    ucl:null, uclCur:null, uclWinner:null, leagueChampion:null
  };
}

function freshClientState() {
  return {
    screen:'home', code:null, teams:[], hostId:null, hostClientId:null,
    draftIdx:0, draftSel:[], _poolScroll:0, readyCount:0, myReady:false,
    fixtures:[], curMatch:0, live:null, lastResult:null,
    standings:{}, scorers:{},
    ucl:null, uclCur:null, uclWinner:null, leagueChampion:null
  };
}

let uidc = 1;
const uid = () => 't' + (uidc++);
let clientIdc = 1;

const getTeam = (S, id) => S.teams.find(t => t.id === id);
const tname = (S, id) => { const t = getTeam(S, id); return t ? t.name : '?'; };

function getPosGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (['RB','CB','LB'].includes(pos)) return 'DEF';
  if (['CDM','CAM'].includes(pos)) return 'MID';
  return 'FWD';
}

function autoFillSquad() {
  const limits = {GK:2,DEF:3,MID:3,FWD:3};
  const groups = {GK:[],DEF:[],MID:[],FWD:[]};
  PLAYERS.forEach(p => groups[getPosGroup(p.pos)].push(p));
  Object.keys(groups).forEach(g => groups[g].sort((a,b) => a.price - b.price));
  const sel = []; let budget = BUDGET;
  Object.keys(groups).forEach(g => {
    let picked = 0;
    for (const p of groups[g]) {
      if (picked >= limits[g]) break;
      if (budget >= p.price) { sel.push(p.id); budget -= p.price; picked++; }
    }
  });
  return sel;
}

function assignDraftToTeam(S, teamIdx, draftSel) {
  const groups = {GK:[],DEF:[],MID:[],FWD:[]};
  draftSel.forEach(id => groups[getPosGroup(byId(id).pos)].push(id));
  Object.keys(groups).forEach(g => groups[g].sort((a,b) => byId(b).price - byId(a).price));
  S.teams[teamIdx].players = [...groups.GK, ...groups.DEF, ...groups.MID, ...groups.FWD];
}

function buildFixtures(S) {
  const ids = S.teams.map(t => t.id);
  const fx = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) fx.push({ a: ids[i], b: ids[j], scoreA: 0, scoreB: 0 });
  }
  S.fixtures = fx;
  S.standings = {};
  S.teams.forEach(t => { S.standings[t.id] = { id: t.id, pts:0, gf:0, ga:0 }; });
}

function standingsRows(S) {
  return Object.values(S.standings).sort((x,y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    const gdx = x.gf - x.ga, gdy = y.gf - y.ga;
    if (gdy !== gdx) return gdy - gdx;
    return y.gf - x.gf;
  });
}

function winnerOf(match) {
  if (!match) return null;
  if (match.scoreA > match.scoreB) return match.a;
  if (match.scoreB > match.scoreA) return match.b;
  return Math.random() < 0.5 ? match.a : match.b;
}

function pickScorer(S, teamId) {
  const team = getTeam(S, teamId);
  if (!team || !team.players || !team.players.length) return '?';
  const fwds = team.players.filter(id => ['RW','LW','ST'].includes(byId(id).pos));
  const mids = team.players.filter(id => ['CDM','CAM'].includes(byId(id).pos));
  const pool = fwds.length ? fwds : (mids.length ? mids : team.players);
  const id = pool[Math.floor(Math.random() * pool.length)];
  return byId(id)?.name || '?';
}

function recordResult(S, fx) {
  const sa = fx.scoreA, sb = fx.scoreB;
  const A = S.standings[fx.a]; const B = S.standings[fx.b];
  if (!A || !B) return;
  A.gf += sa; A.ga += sb; B.gf += sb; B.ga += sa;
  if (sa > sb) A.pts += 3; else if (sb > sa) B.pts += 3; else { A.pts += 1; B.pts += 1; }
}

/* ==================== MAÇ ==================== */
function startMatch(roomCode, fx, isUcl, callback) {
  const S = rooms.get(roomCode);
  if (!S || !fx) return;
  
  S.live = { teamA: fx.a, teamB: fx.b, scoreA: 0, scoreB: 0, minute: 0, events: [] };
  broadcastRoom(roomCode);

  const interval = setInterval(() => {
    if (!S.live) return clearInterval(interval);
    S.live.minute++;

    if (Math.random() < 0.05) {
      const isA = Math.random() < 0.5;
      const scorer = pickScorer(S, isA ? S.live.teamA : S.live.teamB);
      if (isA) S.live.scoreA++; else S.live.scoreB++;
      S.live.events.push({ min: S.live.minute, type: 'goal', text: `${scorer} ⚽ (${tname(S, isA ? S.live.teamA : S.live.teamB)})` });
      if (S.live.events.length > 10) S.live.events.shift();
    }

    broadcastRoom(roomCode);

    if (S.live.minute >= 90) {
      clearInterval(interval);
      fx.scoreA = S.live.scoreA; fx.scoreB = S.live.scoreB;
      if (!isUcl) recordResult(S, fx);
      S.lastResult = { a: fx.a, b: fx.b, scoreA: fx.scoreA, scoreB: fx.scoreB };
      S.live = null;
      broadcastRoom(roomCode);
      if (callback) callback();
    }
  }, 400);
}

function nextLeagueMatch(roomCode) {
  const S = rooms.get(roomCode);
  if (!S) return;
  if (S.curMatch >= S.fixtures.length) {
    const rows = standingsRows(S);
    S.leagueChampion = rows.length ? rows[0].id : null;
    S.screen = 'leagueEnd';
    broadcastRoom(roomCode);
    return;
  }
  const fx = S.fixtures[S.curMatch];
  
  S.screen = 'ready';
  S.readyCount = 0;
  S.myReady = false;
  broadcastRoom(roomCode);

  const startWhenReady = setInterval(() => {
    // Maçtaki iki takımın insan oyuncuları hazır mı kontrolü yapılabilir, 
    // basitlik için tüm insan oyuncuların hazır olmasını bekliyoruz.
    if (S.readyCount >= S.teams.filter(t => !t.isBot).length) {
      clearInterval(startWhenReady);
      S.screen = 'league';
      startMatch(roomCode, fx, false, () => {
        S.curMatch++;
        nextLeagueMatch(roomCode);
      });
    }
  }, 1000);
}

/* ==================== UCL ==================== */
function startUcl(roomCode) {
  const S = rooms.get(roomCode);
  if (!S) return;
  const rows = standingsRows(S);
  if (rows.length < 2) return;
  const ids = rows.map(r => r.id);
  S.uclWinner = null; S.lastResult = null;

  if (ids.length === 2) {
    S.ucl = { final: { name:'FİNAL', a:ids[0], b:ids[1] } }; S.uclCur = 'final';
  } else if (ids.length === 3) {
    S.ucl = { sf: { name:'Yarı Final', a:ids[1], b:ids[2] }, final: { name:'FİNAL', a:ids[0], b:null } }; S.uclCur = 'sf';
  } else {
    S.ucl = { sf1: { name:'Yarı Final 1', a:ids[0], b:ids[3] }, sf2: { name:'Yarı Final 2', a:ids[1], b:ids[2] }, final: { name:'FİNAL', a:null, b:null } }; S.uclCur = 'sf1';
  }
  S.screen = 'ucl';
  broadcastRoom(roomCode);
  setTimeout(() => uclNext(roomCode), 900);
}

function uclNext(roomCode) {
  const S = rooms.get(roomCode);
  if (!S || !S.ucl) return;
  const U = S.ucl;

  if (S.uclCur === 'sf1') {
    startMatch(roomCode, U.sf1, true, () => { S.uclCur = 'sf2'; setTimeout(() => uclNext(roomCode), 1200); });
  } else if (S.uclCur === 'sf2') {
    startMatch(roomCode, U.sf2, true, () => { S.uclCur = 'final'; setTimeout(() => uclNext(roomCode), 1200); });
  } else if (S.uclCur === 'sf') {
    startMatch(roomCode, U.sf, true, () => { U.final.b = winnerOf(U.sf); S.uclCur = 'final'; setTimeout(() => uclNext(roomCode), 1200); });
  } else if (S.uclCur === 'final') {
    if (U.sf1 && U.sf2) { U.final.a = winnerOf(U.sf1); U.final.b = winnerOf(U.sf2); }
    startMatch(roomCode, U.final, true, () => { S.uclWinner = winnerOf(U.final); S.screen = 'trophy'; broadcastRoom(roomCode); });
  }
}

/* ==================== EXPRESS + WS ==================== */
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static(path.join(__dirname, '.')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcastRoom(roomCode) {
  const S = rooms.get(roomCode);
  if (!S) return;
  const msg = { type: 'state', state: S };
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.roomCode === roomCode) client.send(JSON.stringify(msg));
  });
}

wss.on('connection', (ws) => {
  ws.clientId = 'c' + (clientIdc++);
  ws.roomCode = null;

  sendTo(ws, { type: 'init', clientId: ws.clientId, players: PLAYERS, traitDefs: TRAIT_DEFS });
  sendTo(ws, { type: 'state', state: freshClientState() });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const { action, payload = {} } = msg;

      if (action === 'navigate') {
        if (ws.roomCode) {
          const S = rooms.get(ws.roomCode);
          if (S) { S.screen = payload.screen; broadcastRoom(ws.roomCode); }
        } else {
          const st = freshClientState(); st.screen = payload.screen;
          sendTo(ws, { type: 'state', state: st });
        }
        return;
      }

      if (action === 'createTeam') {
        const { name, coach } = payload;
        const code = String(Math.floor(10000 + Math.random() * 90000));
        const S = freshRoom(code);
        const myTeamId = uid();
        S.teams = [{ id: myTeamId, name, coach, isBot:false, players:[], clientId: ws.clientId, formation:'2-2-2', mentality:'dengeli' }];
        S.hostId = myTeamId;
        S.hostClientId = ws.clientId;
        S.screen = 'lobby';
        rooms.set(code, S);
        ws.roomCode = code;
        broadcastRoom(code);
        return;
      }

      if (action === 'joinTeam') {
        const { code, name, coach } = payload;
        const S = rooms.get(code);
        if (!S) return sendTo(ws, { type: 'error', message: 'Geçersiz oda kodu' });
        if (S.teams.length >= MAX_TEAMS) return sendTo(ws, { type: 'error', message: 'Oda dolu' });
        S.teams.push({ id: uid(), name, coach, isBot:false, players:[], clientId: ws.clientId, formation:'2-2-2', mentality:'dengeli' });
        ws.roomCode = code;
        broadcastRoom(code);
        return;
      }

      if (action === 'leaveRoom') {
        if (ws.roomCode) {
          const S = rooms.get(ws.roomCode);
          if (S) {
            if (ws.clientId === S.hostClientId) {
              // Host çıkarsa odayı kapat
              rooms.delete(ws.roomCode);
            } else {
              // Diğer oyuncular çıkarsa takımını sil
              S.teams = S.teams.filter(t => t.clientId !== ws.clientId);
              broadcastRoom(ws.roomCode);
            }
          }
          ws.roomCode = null;
        }
        sendTo(ws, { type: 'state', state: freshClientState() });
        return;
      }

      if (!ws.roomCode) return sendTo(ws, { type: 'error', message: 'Önce bir odaya katılmalısın' });
      const S = rooms.get(ws.roomCode);
      if (!S) return sendTo(ws, { type: 'error', message: 'Oda bulunamadı' });

      switch (action) {
        case 'addBot': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          if (S.teams.length >= MAX_TEAMS) return;
          const used = new Set(S.teams.map(t => t.name));
          const name = BOT_NAMES.find(n => !used.has(n)) || ('Bot Takım ' + (S.teams.length + 1));
          const coach = BOT_COACHES[Math.floor(Math.random() * BOT_COACHES.length)];
          const fR = Math.random(); const formation = fR < 0.33 ? '2-2-2' : (fR < 0.66 ? '3-2-1' : '2-3-1');
          const mR = Math.random(); const mentality = mR < 0.33 ? 'dengeli' : (mR < 0.66 ? 'hucum' : 'savunma');
          S.teams.push({ id: uid(), name, coach, isBot:true, players:[], clientId: null, formation, mentality });
          break;
        }
        case 'removeTeam': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          if (payload.id === S.hostId) return;
          S.teams = S.teams.filter(t => t.id !== payload.id);
          break;
        }
        case 'startDraft': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          if (S.teams.length < 2) return;
          
          // Eksik kadrolu takım var mı kontrol et (Güvenlik)
          // Botlar için sunucu doldurur, insanlar kendi doldurur.
          S.draftIdx = 0; S.draftSel = []; S._poolScroll = 0; S.screen = 'draft';
          break;
        }
        case 'togglePick': {
          const t = S.teams[S.draftIdx];
          if (!t || t.clientId !== ws.clientId || t.isBot) return; 
          const id = Number(payload.id);
          const i = S.draftSel.indexOf(id);
          if (i >= 0) S.draftSel.splice(i, 1);
          else {
            if (S.draftSel.length >= 11) return;
            const p = byId(id); if (!p) return;
            const total = S.draftSel.reduce((a,x) => a + byId(x).price, 0);
            if (total + p.price > BUDGET) return;
            const grp = getPosGroup(p.pos); const limits = {GK:2,DEF:3,MID:3,FWD:3};
            const count = S.draftSel.filter(x => getPosGroup(byId(x).pos) === grp).length;
            if (count >= limits[grp]) return;
            S.draftSel.push(id);
          }
          break;
        }
        case 'autoFillCurrent': {
          const t = S.teams[S.draftIdx];
          if (!t || t.clientId !== ws.clientId) return;
          S.draftSel = autoFillSquad();
          break;
        }
        case 'clearDraft': {
          const t = S.teams[S.draftIdx];
          if (!t || t.clientId !== ws.clientId) return;
          S.draftSel = [];
          break;
        }
        case 'confirmDraft': {
          const t = S.teams[S.draftIdx];
          if (!t || t.clientId !== ws.clientId || S.draftSel.length !== 11) return;
          assignDraftToTeam(S, S.draftIdx, S.draftSel);
          S.draftIdx++; S.draftSel = []; S._poolScroll = 0;

          while (S.draftIdx < S.teams.length && S.teams[S.draftIdx].isBot) {
            const autoSel = autoFillSquad();
            assignDraftToTeam(S, S.draftIdx, autoSel);
            S.draftIdx++;
          }

          if (S.draftIdx >= S.teams.length) {
            buildFixtures(S); S.screen = 'draw';
          }
          break;
        }
        case 'playerReady': {
          S.myReady = true;
          S.readyCount = (S.readyCount || 0) + 1;
          break;
        }
        case 'startLeague': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          if (S.teams.some(t => t.players.length < 11)) {
            return sendTo(ws, { type: 'error', message: 'Tüm takımların 11 kişilik kadrosu olmalı!' });
          }
          S.screen = 'league'; S.curMatch = 0; S.lastResult = null;
          setTimeout(() => nextLeagueMatch(ws.roomCode), 900);
          break;
        }
        case 'startUcl': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          startUcl(ws.roomCode); return; 
        }
        case 'finishGame': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          S.screen = 'end'; break;
        }
        case 'restart': {
          if (ws.clientId !== S.hostClientId) return; // Sadece host
          if (S.live && S.live.interval) clearInterval(S.live.interval);
          const newS = freshRoom(ws.roomCode);
          newS.hostClientId = ws.clientId;
          newS.hostId = S.hostId;
          newS.teams = S.teams.map(t => ({ ...t, players: [] })); // Takımları koru, kadroları sıfırla
          rooms.set(ws.roomCode, newS);
          broadcastRoom(ws.roomCode); return;
        }
        default: break;
      }
      broadcastRoom(ws.roomCode);
    } catch (e) { console.error('WS mesaj hatası:', e); }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      const S = rooms.get(ws.roomCode);
      if (S) {
        if (ws.clientId === S.hostClientId) {
          rooms.delete(ws.roomCode); // Host çıktıysa odayı kapat
        } else {
          S.teams = S.teams.filter(t => t.clientId !== ws.clientId);
          broadcastRoom(ws.roomCode);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));