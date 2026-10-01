import { io } from 'socket.io-client';

const url = process.env.TEST_SERVER_URL ?? 'http://localhost:3001';
const clients = [io(url), io(url)];
const sessions = [];
let verified = false;

for (const [index, client] of clients.entries()) {
  client.on('connect', () => client.emit('queue:join', { name: `Smoke${index + 1}`, color: index ? 'cyan' : 'pink' }));
  client.on('session:ready', (session) => { sessions[index] = session; if (sessions.length === 2 && sessions.every(Boolean)) clients[0].emit('player:input', { up: false, down: false, left: false, right: true, firing: false, dash: true, angle: 0 }); });
  client.on('arena:state', (snapshot) => {
    if (verified || sessions.length < 2 || !sessions.every(Boolean)) return;
    const first = snapshot.players.find((player) => player.id === sessions[0].playerId);
    const second = snapshot.players.find((player) => player.id === sessions[1].playerId);
    if (!first || !second || sessions[0].arenaId !== sessions[1].arenaId || first.dashCooldown <= 0 || snapshot.width < 3300 || snapshot.environment.length < 20) return;
    verified = true;
    console.log(JSON.stringify({ ok: true, arenaId: sessions[0].arenaId, humansVisible: [first.name, second.name], dashCooldown: first.dashCooldown, bots: snapshot.bots, arena: `${snapshot.width}x${snapshot.height}`, coverObjects: snapshot.environment.length }));
    for (const socket of clients) socket.disconnect();
    process.exit(0);
  });
}

setTimeout(() => { console.error('Multiplayer smoke test timed out.'); for (const socket of clients) socket.disconnect(); process.exit(1); }, 8000);
