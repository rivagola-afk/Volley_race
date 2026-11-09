const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 20;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();


function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out;
  do out = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  while (rooms.has(out));
  return out;
}

function token() { return crypto.randomBytes(18).toString('hex'); }

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    round: room.round,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, score:p.score, progress:p.progress,
      place:p.place, finished:p.finished, connected:p.connected
    }))
  };
}

function sendSse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}
function broadcast(room, obj) {
  for (const res of room.streams) {
    try { sendSse(res, obj); } catch (_) {}
  }
}
function emitRoom(room) { broadcast(room, {type:'roomState', state:publicRoom(room)}); }

function stopRace(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function runRace(room) {
  stopRace(room);
  room.status = 'racing';
  room.round += 1;
  room.finishedCount = 0;
  for (const p of room.players.values()) {
    if (!p.connected) continue;
    Object.assign(p, {
      progress:0, place:null, finished:false, stumbleTicks:0, netCleared:false,
      base:0.55 + Math.random()*0.45,
      boost:Math.random()*0.25
    });
  }
  broadcast(room, {type:'raceStarted', round:room.round});
  emitRoom(room);

  room.timer = setInterval(() => {
    const active = [...room.players.values()].filter(p => p.connected && !p.finished);
    for (const p of active) {
      if (p.stumbleTicks > 0) { p.stumbleTicks -= 1; continue; }
      const noise = Math.random()*0.9;
      const burst = Math.random() < 0.07 ? 1.6 + Math.random()*1.5 : 0;
      let step = p.base + p.boost + noise + burst;
      if (!p.netCleared && p.progress >= 47 && p.progress < 52) {
        p.netCleared = true;
        if (Math.random() < 0.36) {
          p.stumbleTicks = 2 + Math.floor(Math.random()*4);
          step *= 0.2;
          broadcast(room, {type:'raceMoment', id:p.id, moment:'net'});
        } else if (Math.random() < 0.35) {
          step += 2.2;
          broadcast(room, {type:'raceMoment', id:p.id, moment:'ace'});
        }
      }
      p.progress = Math.min(100, p.progress + step);
      if (p.progress >= 100 && !p.finished) {
        p.finished = true;
        p.place = ++room.finishedCount;
        const points = Math.max(1, 21 - (p.place-1)*2);
        p.score += points;
        broadcast(room, {type:'playerFinished', id:p.id, name:p.name, place:p.place, points});
      }
    }
    emitRoom(room);
    const connected = [...room.players.values()].filter(p => p.connected);
    if (!connected.length || connected.every(p => p.finished)) {
      stopRace(room);
      room.status = 'results';
      broadcast(room, {type:'raceEnded'});
      emitRoom(room);
    }
  }, 120);
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 100000) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'})[ext] || 'application/octet-stream';
}

function serveFile(res, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return json(res,403,{error:'Forbidden'});
  fs.readFile(file, (err, data) => {
    if (err) return json(res,404,{error:'No encontrado'});
    res.writeHead(200, {'Content-Type':mime(file),'Cache-Control':'no-store'});
    res.end(data);
  });
}

function roomAndHost(body) {
  const room = rooms.get(String(body.code || '').trim().toUpperCase());
  if (!room) return {error:'Sala no encontrada.'};
  if (room.hostToken !== body.hostToken) return {error:'No autorizado.'};
  return {room};
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/host')) return serveFile(res,'host.html');
    if (req.method === 'GET' && url.pathname === '/join') return serveFile(res,'player.html');
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
      const host = req.headers.host || `localhost:${PORT}`;
      const origin = `${proto}://${host}`;
      return json(res,200,{port:PORT,joinUrl:`${origin}/join`,hostUrl:`${origin}/host`});
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res,200,{ok:true,rooms:rooms.size,now:Date.now()});
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
      if (!room) return json(res,404,{error:'Sala no encontrada.'});
      const hostToken = url.searchParams.get('hostToken');
      const playerToken = url.searchParams.get('playerToken');
      const playerId = url.searchParams.get('playerId');
      const hostOk = hostToken && hostToken === room.hostToken;
      const p = playerId ? room.players.get(playerId) : null;
      const playerOk = p && playerToken && playerToken === p.token;
      if (!hostOk && !playerOk) return json(res,403,{error:'No autorizado.'});
      res.writeHead(200, {
        'Content-Type':'text/event-stream',
        'Cache-Control':'no-cache, no-transform',
        'Connection':'keep-alive',
        'Access-Control-Allow-Origin':'*'
      });
      res.write(': connected\n\n');
      room.streams.add(res);
      sendSse(res,{type:'roomState',state:publicRoom(room)});
      const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
      req.on('close', () => { clearInterval(keepAlive); room.streams.delete(res); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const roomCode = code();
      const room = {code:roomCode,hostToken:token(),players:new Map(),streams:new Set(),status:'lobby',round:0,timer:null,finishedCount:0,createdAt:Date.now()};
      rooms.set(roomCode,room);
      return json(res,200,{ok:true,room:publicRoom(room),hostToken:room.hostToken});
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readBody(req);
      const c = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim().replace(/\s+/g,' ').slice(0,18);
      const room = rooms.get(c);
      if (!room) return json(res,404,{ok:false,error:'No existe una sala con ese código.'});
      if (room.status === 'racing') return json(res,409,{ok:false,error:'La carrera ya comenzó. Espera la próxima ronda.'});
      if (!name) return json(res,400,{ok:false,error:'Escribe tu nombre.'});
      if ([...room.players.values()].filter(p=>p.connected).length >= MAX_PLAYERS) return json(res,409,{ok:false,error:'La sala está llena.'});
      if ([...room.players.values()].some(p=>p.connected && p.name.toLowerCase()===name.toLowerCase())) return json(res,409,{ok:false,error:'Ese nombre ya está siendo usado.'});
      const id = token().slice(0,12);
      const playerToken = token();
      room.players.set(id,{id,token:playerToken,name,score:0,progress:0,place:null,finished:false,connected:true});
      emitRoom(room);
      return json(res,200,{ok:true,playerId:id,playerToken,room:publicRoom(room)});
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      const body = await readBody(req); const out = roomAndHost(body); if (out.error) return json(res,403,{ok:false,error:out.error});
      const connected=[...out.room.players.values()].filter(p=>p.connected);
      if (!connected.length) return json(res,409,{ok:false,error:'Necesitas al menos 1 jugador.'});
      runRace(out.room); return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/lobby') {
      const body = await readBody(req); const out = roomAndHost(body); if (out.error) return json(res,403,{ok:false,error:out.error});
      stopRace(out.room); out.room.status='lobby';
      for (const p of out.room.players.values()) {p.progress=0;p.place=null;p.finished=false;}
      emitRoom(out.room); return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const body = await readBody(req); const out = roomAndHost(body); if (out.error) return json(res,403,{ok:false,error:out.error});
      stopRace(out.room); out.room.status='lobby'; out.room.round=0;
      for (const p of out.room.players.values()) {p.score=0;p.progress=0;p.place=null;p.finished=false;}
      emitRoom(out.room); return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && url.pathname === '/api/kick') {
      const body = await readBody(req); const out = roomAndHost(body); if (out.error) return json(res,403,{ok:false,error:out.error});
      out.room.players.delete(String(body.playerId || '')); emitRoom(out.room); return json(res,200,{ok:true});
    }
    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      const rel = url.pathname.slice(1);
      if (rel && !rel.includes('..')) return serveFile(res,rel);
    }
    return json(res,404,{error:'No encontrado'});
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res,500,{error:'Error interno'}); else res.end();
  }
});

setInterval(() => {
  const cutoff = Date.now() - 2*60*60*1000;
  for (const [c,r] of rooms) if (r.createdAt < cutoff) { stopRace(r); rooms.delete(c); }
}, 10*60*1000).unref();

server.listen(PORT,'0.0.0.0',() => {
  console.log('\n🏐 VOLLEY RACE listo');
  console.log(`Local: http://localhost:${PORT}/host`);
  console.log('En hosting público, profesor y alumnos usan la URL HTTPS del servicio.\n');
});
