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
const colors: PlayerColor[] = ['pink', 'cyan', 'lime', 'orange', 'violet', 'yellow'];

type Input = { up: boolean; down: boolean; left: boolean; right: boolean; firing: boolean; angle: number };
type Player = PlayerSnapshot & { socketId?: string; token: string; input: Input; disconnectAt?: number; fireCooldown: number; xpProgress: number };
type Arena = { id: ArenaId; players: Map<string, Player>; dots: DotSnapshot[] };

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
  return { id, socketId, token: randomUUID(), name, color, x: point.x, y: point.y, angle: 0, health: 100, maxHealth: 100, level: 1, xp: 0, eliminations: 0, deaths: 0, shielded: true, isBot, input: { up: false, down: false, left: false, right: false, firing: false, angle: 0 }, fireCooldown: 0, xpProgress: 0 };
}
function addBots(arena: Arena) { while ([...arena.players.values()].filter((player) => player.isBot).length < BOT_COUNT) { const bot = createPlayer(`bot-${arena.id}-${randomUUID().slice(0, 5)}`, '', `BOT-${Math.floor(Math.random() * 900 + 100)}`, colors[Math.floor(Math.random() * colors.length)], arena, true); arena.players.set(bot.id, bot); } }
function snapshot(arena: Arena): ArenaSnapshot { return { arenaId: arena.id, online: [...arena.players.values()].filter((p) => !p.isBot).length, bots: [...arena.players.values()].filter((p) => p.isBot).length, players: [...arena.players.values()].map(({ socketId, token, input, disconnectAt, fireCooldown, xpProgress, ...player }) => player), dots: arena.dots }; }
function awardXp(player: Player, amount: number) { player.xp += amount; player.xpProgress += amount; while (player.xpProgress >= player.level * 100) { player.xpProgress -= player.level * 100; player.level += 1; player.maxHealth += 5; player.health = Math.min(player.maxHealth, player.health + 20); } }
function respawn(player: Player, arena: Arena) { const point = spawn(arena); player.x = point.x; player.y = point.y; player.health = player.maxHealth; player.shielded = true; setTimeout(() => { player.shielded = false; }, 2500); }

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, arenas: ARENA_COUNT }));
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN?.split(',') ?? '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
  socket.on('queue:join', ({ name, color }) => {
    const result = validateNickname(name);
    if (!result.ok || !colors.includes(color)) { socket.emit('player:error', { message: result.ok ? 'Choose a valid color.' : result.error }); return; }
    const arena = arenas.filter((candidate) => [...candidate.players.values()].filter((p) => !p.isBot).length < MAX_HUMANS).sort((a, b) => a.players.size - b.players.size)[0];
    if (!arena) { socket.emit('player:error', { message: 'All arenas are full. Try again soon.' }); return; }
    const player = createPlayer(socket.id, socket.id, result.value, color, arena);
    arena.players.set(player.id, player); socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:reconnect', ({ token }) => {
    const player = arenas.flatMap((arena) => [...arena.players.values()]).find((candidate) => candidate.token === token && candidate.disconnectAt);
    if (!player) { socket.emit('player:error', { message: 'That arena session has expired.' }); return; }
    const arena = arenas.find((candidate) => candidate.players.has(player.id));
    if (!arena) { socket.emit('player:error', { message: 'That arena session has expired.' }); return; }
    player.socketId = socket.id; player.disconnectAt = undefined; socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:input', (input) => { const player = findPlayer(socket.id); if (player) player.input = { ...player.input, ...input, angle: Number.isFinite(input.angle) ? input.angle : player.angle }; });
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
      if (player.isBot) { player.input.angle += (Math.random() - 0.5) * 0.4; player.input.right = Math.random() > 0.5; player.input.left = !player.input.right; player.input.firing = Math.random() > 0.35; }
      const dx = Number(player.input.right) - Number(player.input.left); const dy = Number(player.input.down) - Number(player.input.up); const length = Math.hypot(dx, dy) || 1;
      player.x = Math.max(35, Math.min(WIDTH - 35, player.x + (dx / length) * 5)); player.y = Math.max(35, Math.min(HEIGHT - 35, player.y + (dy / length) * 5)); player.angle = player.input.angle;
      player.fireCooldown = Math.max(0, player.fireCooldown - 50); if (player.input.firing && player.fireCooldown === 0) { player.fireCooldown = Math.max(180 - player.level * 5, 90); const target = [...arena.players.values()].filter((other) => other.id !== player.id && !other.shielded).sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0]; if (target && Math.hypot(target.x - player.x, target.y - player.y) < 420 && Math.abs(Math.atan2(target.y - player.y, target.x - player.x) - player.angle) < 0.45) { target.health -= 18; awardXp(player, 8); if (target.health <= 0) { player.eliminations += 1; awardXp(player, 75); target.deaths += 1; respawn(target, arena); } } }
      const dot = arena.dots.find((candidate) => Math.hypot(candidate.x - player.x, candidate.y - player.y) < 34); if (dot) { awardXp(player, dot.value); Object.assign(dot, makeDot(dot.id)); }
    }
    io.emit('arena:state', snapshot(arena));
  }
}, 50);

httpServer.listen(PORT, () => console.log(`Dot Tank server listening on http://localhost:${PORT}`));
