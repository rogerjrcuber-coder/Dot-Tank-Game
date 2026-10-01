import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { validateNickname } from '../shared/profanity.ts';
import type { ArenaId, ArenaSnapshot, ClientToServerEvents, DotSnapshot, PlayerColor, PlayerSnapshot, ServerToClientEvents } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 3001);
const ARENA_COUNT = 5;
const MAX_HUMANS = 10;
const BOT_COUNT = 5;
const WIDTH = 2200;
const HEIGHT = 1400;
const MAX_LEVEL = 10;
const RESPAWN_DELAY = 1500;
const SPAWN_SHIELD = 2500;
const colors: PlayerColor[] = ['pink', 'cyan', 'lime', 'orange', 'violet', 'yellow'];

type Input = { up: boolean; down: boolean; left: boolean; right: boolean; firing: boolean; angle: number };
type Player = PlayerSnapshot & { socketId?: string; token: string; input: Input; disconnectAt?: number; fireCooldown: number; xpProgress: number; respawnAt?: number; bumpCooldown: number };
type Arena = { id: ArenaId; players: Map<string, Player>; dots: DotSnapshot[] };
const roomFor = (arena: Arena) => `arena:${arena.id}`;

const arenas: Arena[] = Array.from({ length: ARENA_COUNT }, (_, id) => ({
  id: id as ArenaId,
  players: new Map(),
  dots: Array.from({ length: 70 }, (_, index) => makeDot(`${id}-${index}`))
}));

function makeDot(id: string): DotSnapshot { return { id, x: 70 + Math.random() * (WIDTH - 140), y: 70 + Math.random() * (HEIGHT - 140), value: 10 + Math.floor(Math.random() * 10) }; }
function spawn(arena: Arena): { x: number; y: number } {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const point = { x: 100 + Math.random() * (WIDTH - 200), y: 100 + Math.random() * (HEIGHT - 200) };
    if ([...arena.players.values()].every((player) => Math.hypot(player.x - point.x, player.y - point.y) > 220)) return point;
  }
  return { x: WIDTH / 2, y: HEIGHT / 2 };
}
function createPlayer(id: string, socketId: string, name: string, color: PlayerColor, arena: Arena, isBot = false): Player {
  const point = spawn(arena);
  const player: Player = { id, socketId, token: randomUUID(), name, color, x: point.x, y: point.y, angle: 0, health: 100, maxHealth: 100, level: 1, xp: 0, eliminations: 0, deaths: 0, shielded: true, isBot, input: { up: false, down: false, left: false, right: false, firing: false, angle: 0 }, fireCooldown: 0, xpProgress: 0, bumpCooldown: 0 };
  setTimeout(() => { player.shielded = false; }, SPAWN_SHIELD);
  return player;
}
function addBots(arena: Arena) { while ([...arena.players.values()].filter((player) => player.isBot).length < BOT_COUNT) { const bot = createPlayer(`bot-${arena.id}-${randomUUID().slice(0, 5)}`, '', `BOT-${Math.floor(Math.random() * 900 + 100)}`, colors[Math.floor(Math.random() * colors.length)], arena, true); arena.players.set(bot.id, bot); } }
function snapshot(arena: Arena): ArenaSnapshot { return { arenaId: arena.id, online: [...arena.players.values()].filter((p) => !p.isBot).length, bots: [...arena.players.values()].filter((p) => p.isBot).length, players: [...arena.players.values()].map(({ socketId, token, input, disconnectAt, fireCooldown, xpProgress, respawnAt, bumpCooldown, ...player }) => player), dots: arena.dots }; }
function awardXp(player: Player, amount: number) { player.xp += amount; player.xpProgress += amount; while (player.level < MAX_LEVEL && player.xpProgress >= player.level * 100) { player.xpProgress -= player.level * 100; player.level += 1; player.maxHealth += 5; player.health = Math.min(player.maxHealth, player.health + 20); } }
function respawn(player: Player, arena: Arena) { player.health = 0; player.input.firing = false; player.respawnAt = Date.now() + RESPAWN_DELAY; player.shielded = false; }
function completeRespawn(player: Player, arena: Arena) { const point = spawn(arena); player.x = point.x; player.y = point.y; player.health = player.maxHealth; player.shielded = true; player.respawnAt = undefined; setTimeout(() => { player.shielded = false; }, SPAWN_SHIELD); }

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, arenas: ARENA_COUNT }));
const httpServer = createServer(app);
const configuredOrigins = process.env.PUBLIC_ORIGIN ?? process.env.CLIENT_ORIGIN;
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: configuredOrigins?.split(',').map((origin) => origin.trim()) ?? '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
  socket.on('queue:join', ({ name, color }) => {
    const result = validateNickname(name);
    if (!result.ok || !colors.includes(color)) { socket.emit('player:error', { message: result.ok ? 'Choose a valid color.' : result.error }); return; }
    const arena = arenas.filter((candidate) => [...candidate.players.values()].filter((p) => !p.isBot).length < MAX_HUMANS).sort((a, b) => a.players.size - b.players.size)[0];
    if (!arena) { socket.emit('player:error', { message: 'All arenas are full. Try again soon.' }); return; }
    const player = createPlayer(socket.id, socket.id, result.value, color, arena);
    arena.players.set(player.id, player); socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    void socket.join(roomFor(arena));
    socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:reconnect', ({ token }) => {
    const player = arenas.flatMap((arena) => [...arena.players.values()]).find((candidate) => candidate.token === token && candidate.disconnectAt);
    if (!player) { socket.emit('player:error', { message: 'That arena session has expired.' }); return; }
    const arena = arenas.find((candidate) => candidate.players.has(player.id));
    if (!arena) { socket.emit('player:error', { message: 'That arena session has expired.' }); return; }
    player.socketId = socket.id; player.disconnectAt = undefined; socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    void socket.join(roomFor(arena));
    socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:input', (input) => {
    const player = findPlayer(socket.id);
    if (!player) return;
    player.input = {
      up: Boolean(input.up), down: Boolean(input.down), left: Boolean(input.left), right: Boolean(input.right),
      firing: Boolean(input.firing), angle: Number.isFinite(input.angle) ? input.angle : player.angle
    };
  });
  socket.on('queue:leave', () => removePlayer(socket.id));
  socket.on('disconnect', () => { const player = findPlayer(socket.id); if (player) { player.socketId = undefined; player.disconnectAt = Date.now(); } });
});

function findPlayer(socketId: string): Player | undefined { return arenas.flatMap((arena) => [...arena.players.values()]).find((player) => player.socketId === socketId); }
function removePlayer(socketId: string) { for (const arena of arenas) for (const [id, player] of arena.players) if (player.socketId === socketId) arena.players.delete(id); }

setInterval(() => {
  for (const arena of arenas) {
    addBots(arena);
    for (const [id, player] of arena.players) {
      if (player.disconnectAt && Date.now() - player.disconnectAt > 30000) arena.players.delete(id);
      if (player.respawnAt) { if (Date.now() >= player.respawnAt) completeRespawn(player, arena); else continue; }
      if (player.isBot) { player.input.angle += (Math.random() - 0.5) * 0.4; player.input.right = Math.random() > 0.5; player.input.left = !player.input.right; player.input.firing = Math.random() > 0.35; }
      const dx = Number(player.input.right) - Number(player.input.left); const dy = Number(player.input.down) - Number(player.input.up); const length = Math.hypot(dx, dy) || 1;
      const movementSpeed = Math.min(6, 5 + (player.level - 1) * 0.12);
      player.x = Math.max(35, Math.min(WIDTH - 35, player.x + (dx / length) * movementSpeed)); player.y = Math.max(35, Math.min(HEIGHT - 35, player.y + (dy / length) * movementSpeed)); player.angle = player.input.angle;
      player.fireCooldown = Math.max(0, player.fireCooldown - 50); if (player.input.firing && player.fireCooldown === 0) { player.fireCooldown = Math.max(180 - Math.min(player.level - 1, 9) * 6, 126); const target = [...arena.players.values()].filter((other) => other.id !== player.id && !other.shielded && !other.respawnAt).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0]; if (target && Math.hypot(target.x - player.x, target.y - player.y) < 420 && angleDistance(Math.atan2(target.y - player.y, target.x - player.x), player.angle) < 0.45) { target.health -= 18; awardXp(player, 8); if (target.health <= 0) { player.eliminations += 1; awardXp(player, 75); target.deaths += 1; respawn(target, arena); } } }
      const dot = arena.dots.find((candidate) => Math.hypot(candidate.x - player.x, candidate.y - player.y) < 34); if (dot) { awardXp(player, dot.value); Object.assign(dot, makeDot(dot.id)); }
    }
    resolveBumps(arena);
    io.to(roomFor(arena)).emit('arena:state', snapshot(arena));
  }
}, 50);

function angleDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function resolveBumps(arena: Arena) {
  const players = [...arena.players.values()].filter((player) => !player.respawnAt);
  for (let firstIndex = 0; firstIndex < players.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < players.length; secondIndex += 1) {
      const first = players[firstIndex]; const second = players[secondIndex];
      let dx = second.x - first.x; let dy = second.y - first.y; const distance = Math.hypot(dx, dy);
      if (distance >= 44) continue;
      if (distance === 0) { dx = 1; dy = 0; } else { dx /= distance; dy /= distance; }
      const push = (44 - distance) / 2; first.x = Math.max(35, first.x - dx * push); first.y = Math.max(35, first.y - dy * push); second.x = Math.min(WIDTH - 35, second.x + dx * push); second.y = Math.min(HEIGHT - 35, second.y + dy * push);
      if (first.bumpCooldown === 0 && second.bumpCooldown === 0) { first.health -= 1; second.health -= 1; first.bumpCooldown = 500; second.bumpCooldown = 500; if (first.health <= 0) { first.deaths += 1; respawn(first, arena); } if (second.health <= 0) { second.deaths += 1; respawn(second, arena); } }
    }
  }
  for (const player of players) player.bumpCooldown = Math.max(0, player.bumpCooldown - 50);
}

httpServer.listen(PORT, () => console.log(`Dot Tank server listening on http://localhost:${PORT}`));
