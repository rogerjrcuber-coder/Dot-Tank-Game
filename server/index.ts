import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { validateNickname } from '../shared/profanity.ts';
import type { ArenaId, ArenaSnapshot, BotPersonality, BulletSnapshot, ClientToServerEvents, DotSnapshot, EnvironmentSnapshot, KillFeedItem, ObjectiveSnapshot, PlayerColor, PlayerInput, PlayerSnapshot, PowerUpKind, PowerUpSnapshot, ServerToClientEvents } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 3001);
const ARENA_COUNT = 5;
const MAX_HUMANS = Number(process.env.MAX_HUMANS ?? 10);
const BOT_COUNT = Number(process.env.BOT_COUNT ?? 5);
const WIDTH = 3400;
const HEIGHT = 2200;
const BOUNDARY = 110;
const TICK_MS = 50;
const MAX_LEVEL = 10;
const RESPAWN_DELAY = 1800;
const SPAWN_SHIELD = 2500;
const DASH_COOLDOWN = 2600;
const DASH_DURATION = 250;
const OBJECTIVE_INTERVAL = 300000;
const POWER_UP_DURATION = 90000;
const colors: PlayerColor[] = ['pink', 'cyan', 'lime', 'orange', 'violet', 'yellow'];
const personalities: BotPersonality[] = ['hunter', 'collector', 'berserker', 'sniper', 'opportunist', 'survivor'];

type Player = PlayerSnapshot & {
  socketId?: string; token: string; input: PlayerInput; disconnectAt?: number; fireCooldown: number;
  xpProgress: number; respawnAt?: number; dashUntil: number; bumpCooldown: number; outsideSince?: number;
  lastHitBy?: string; lastHitAt?: number; aiThinkAt: number; aiTargetAngle: number; aiFireAt: number;
  staggerUntil: number; dotsCollected: number; concealed: boolean; powerUp?: PowerUpKind; powerUpUntil: number;
};
type Bullet = BulletSnapshot & { ownerId: string; vx: number; vy: number; ttl: number; damage: number };
type Arena = { id: ArenaId; players: Map<string, Player>; dots: DotSnapshot[]; bullets: Bullet[]; environment: EnvironmentSnapshot[]; objective?: ObjectiveSnapshot; nextObjectiveAt: number; powerUps: PowerUpSnapshot[]; killFeed: KillFeedItem[] };

const emptyInput = (): PlayerInput => ({ up: false, down: false, left: false, right: false, firing: false, dash: false, angle: 0 });
const roomFor = (arena: Arena) => `arena:${arena.id}`;
const arenas: Arena[] = Array.from({ length: ARENA_COUNT }, (_, id) => ({
  id: id as ArenaId, players: new Map(), bullets: [], killFeed: [], powerUps: [], objective: undefined,
  nextObjectiveAt: Date.now() + OBJECTIVE_INTERVAL, environment: makeEnvironment(id),
  dots: Array.from({ length: 130 }, (_, index) => makeDot(`${id}-${index}`))
}));
for (const arena of arenas) for (const dot of arena.dots) relocateDot(dot, arena);

function makeDot(id: string): DotSnapshot { return { id, x: BOUNDARY + 40 + Math.random() * (WIDTH - (BOUNDARY + 40) * 2), y: BOUNDARY + 40 + Math.random() * (HEIGHT - (BOUNDARY + 40) * 2), value: 10 + Math.floor(Math.random() * 10) }; }
function makeEnvironment(seed: number): EnvironmentSnapshot[] {
  const items: EnvironmentSnapshot[] = [];
  const add = (kind: EnvironmentSnapshot['kind'], x: number, y: number, width: number, height: number, solid: boolean) => items.push({ id: `${seed}-${kind}-${items.length}`, kind, x, y, width, height, solid });
  for (const [x, y, width, height] of [[330, 430, 590, 120], [2440, 440, 590, 120], [2390, 1510, 600, 120]]) add('brick', x, y, width, height, true);
  for (const [x, y, width, height] of [[570, 190, 720, 105], [2780, 790, 125, 520], [980, 1450, 390, 90]]) add('rock', x, y, width, height, true);
  for (const [x, y, width, height] of [[160, 760, 190, 180], [660, 930, 220, 190], [2020, 100, 230, 180], [2220, 850, 250, 200], [1660, 1640, 280, 200]]) add('bush', x, y, width, height, false);
  for (let index = 0; index < 14; index += 1) add(index % 2 ? 'flower' : 'gravel', 280 + ((index * 241 + seed * 73) % 2800), 250 + ((index * 173 + seed * 91) % 1650), 72, 58, false);
  add('dirt', 1380, 900, 640, 390, false); add('gravel', 250, 260, 420, 300, false);
  return items;
}
function spawn(arena: Arena) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const point = { x: BOUNDARY + 80 + Math.random() * (WIDTH - (BOUNDARY + 80) * 2), y: BOUNDARY + 80 + Math.random() * (HEIGHT - (BOUNDARY + 80) * 2) };
    const clearOfPlayers = [...arena.players.values()].filter((player) => !player.respawnAt).every((player) => Math.hypot(player.x - point.x, player.y - point.y) > 260);
    const clearOfCover = arena.environment.every((item) => !item.solid || point.x < item.x - 55 || point.x > item.x + item.width + 55 || point.y < item.y - 55 || point.y > item.y + item.height + 55);
    if (clearOfPlayers && clearOfCover) return point;
  }
  return { x: WIDTH / 2, y: HEIGHT / 2 };
}

function createPlayer(id: string, socketId: string, name: string, color: PlayerColor, arena: Arena, isBot = false): Player {
  const point = spawn(arena);
  const player: Player = {
    id, socketId, token: randomUUID(), name, color, arenaId: arena.id, x: point.x, y: point.y, angle: 0, vx: 0, vy: 0,
    health: 100, maxHealth: 100, level: 1, xp: 0, eliminations: 0, deaths: 0, shielded: true, isBot,
    connected: isBot || Boolean(socketId), dashing: false, dashCooldown: 0, respawnIn: 0, staggeredIn: 0, powerUpIn: 0,
    personality: isBot ? personalities[Math.floor(Math.random() * personalities.length)] : undefined,
    input: emptyInput(), fireCooldown: 0, xpProgress: 0, dashUntil: 0, bumpCooldown: 0, aiThinkAt: 0,
    aiTargetAngle: 0, aiFireAt: 0, staggerUntil: 0, dotsCollected: 0, concealed: false, powerUpUntil: 0
  };
  setTimeout(() => { if (!player.respawnAt) player.shielded = false; }, SPAWN_SHIELD);
  return player;
}

function addBots(arena: Arena) {
  while ([...arena.players.values()].filter((player) => player.isBot).length < BOT_COUNT) {
    const personality = personalities[Math.floor(Math.random() * personalities.length)];
    const bot = createPlayer(`bot-${arena.id}-${randomUUID().slice(0, 5)}`, '', `${personality.toUpperCase()}-${Math.floor(Math.random() * 90 + 10)}`, colors[Math.floor(Math.random() * colors.length)], arena, true);
    arena.players.set(bot.id, bot);
  }
}

function snapshot(arena: Arena): ArenaSnapshot {
  const now = Date.now();
  return {
    arenaId: arena.id, width: WIDTH, height: HEIGHT, boundary: BOUNDARY, serverTime: now,
    online: [...arena.players.values()].filter((player) => !player.isBot && player.connected).length,
    bots: [...arena.players.values()].filter((player) => player.isBot).length,
    players: [...arena.players.values()].map((player) => ({
      id: player.id, name: player.name, color: player.color, arenaId: player.arenaId, x: player.x, y: player.y,
      angle: player.angle, vx: player.vx, vy: player.vy, health: player.health, maxHealth: player.maxHealth,
      level: player.level, xp: player.xp, eliminations: player.eliminations, deaths: player.deaths,
      shielded: player.shielded, isBot: player.isBot, connected: player.connected, dashing: player.dashing,
      dashCooldown: player.dashCooldown, respawnIn: player.respawnAt ? Math.max(0, player.respawnAt - now) : 0,
      staggeredIn: Math.max(0, player.staggerUntil - now), concealed: player.concealed, dotsCollected: player.dotsCollected,
      powerUp: player.powerUpUntil > now ? player.powerUp : undefined, powerUpIn: Math.max(0, player.powerUpUntil - now),
      personality: player.personality
    })),
    dots: arena.dots, bullets: arena.bullets.map(({ ownerId, vx, vy, ttl, damage, ...bullet }) => bullet),
    environment: arena.environment, objective: arena.objective, nextObjectiveIn: Math.max(0, arena.nextObjectiveAt - now), powerUps: arena.powerUps,
    killFeed: arena.killFeed.slice(-5)
  };
}

function awardXp(player: Player, amount: number) {
  player.xp += amount; player.xpProgress += amount;
  while (player.level < MAX_LEVEL && player.xpProgress >= player.level * 100) {
    player.xpProgress -= player.level * 100; player.level += 1; player.maxHealth += 5; player.health = Math.min(player.maxHealth, player.health + 20);
  }
}

function defeat(victim: Player, arena: Arena, cause: KillFeedItem['cause'], attackerId?: string) {
  if (victim.respawnAt) return;
  const attacker = attackerId ? arena.players.get(attackerId) : undefined;
  victim.deaths += 1; victim.health = 0; victim.vx = 0; victim.vy = 0; victim.input = emptyInput();
  victim.respawnAt = Date.now() + RESPAWN_DELAY; victim.respawnIn = RESPAWN_DELAY; victim.shielded = false; victim.outsideSince = undefined;
  if (attacker && attacker.id !== victim.id) { attacker.eliminations += 1; awardXp(attacker, 75); }
  arena.killFeed.push({ id: randomUUID(), attacker: attacker?.name ?? 'THE ARENA', victim: victim.name, cause, createdAt: Date.now() });
  if (arena.killFeed.length > 8) arena.killFeed.shift();
}

function completeRespawn(player: Player, arena: Arena) {
  const point = spawn(arena); player.x = point.x; player.y = point.y; player.vx = 0; player.vy = 0;
  player.health = player.maxHealth; player.respawnAt = undefined; player.respawnIn = 0; player.shielded = true;
  setTimeout(() => { if (!player.respawnAt) player.shielded = false; }, SPAWN_SHIELD);
}

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, arenas: ARENA_COUNT, maxHumans: MAX_HUMANS }));
const httpServer = createServer(app);
const configuredOrigins = process.env.PUBLIC_ORIGIN ?? process.env.CLIENT_ORIGIN;
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: configuredOrigins?.split(',').map((origin) => origin.trim().replace(/\/$/, '')) ?? '*', methods: ['GET', 'POST'] } });

io.on('connection', (socket) => {
  socket.on('queue:join', ({ name, color }) => {
    const result = validateNickname(name);
    if (!result.ok || !colors.includes(color)) { socket.emit('player:error', { message: result.ok ? 'Choose a valid color.' : 'Please choose a different nickname.' }); return; }
    const arena = arenas.filter((candidate) => humanCount(candidate) < MAX_HUMANS).sort((first, second) => humanCount(second) - humanCount(first) || first.id - second.id)[0];
    if (!arena) { socket.emit('player:error', { message: 'All arenas are full. Try again soon.' }); return; }
    const player = createPlayer(socket.id, socket.id, result.value, color, arena);
    arena.players.set(player.id, player); socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    void socket.join(roomFor(arena)); socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:reconnect', ({ token }) => {
    const player = arenas.flatMap((arena) => [...arena.players.values()]).find((candidate) => candidate.token === token && candidate.disconnectAt && Date.now() - candidate.disconnectAt <= 30000);
    const arena = player && arenas.find((candidate) => candidate.players.has(player.id));
    if (!player || !arena) { socket.emit('player:error', { message: 'That arena session has expired.' }); return; }
    player.socketId = socket.id; player.disconnectAt = undefined; player.connected = true; socket.data.playerId = player.id; socket.data.arenaId = arena.id; socket.data.token = player.token;
    void socket.join(roomFor(arena)); socket.emit('session:ready', { token: player.token, arenaId: arena.id, playerId: player.id });
  });
  socket.on('player:input', (input) => {
    const player = findPlayer(socket.id); if (!player) return;
    player.input = { up: Boolean(input.up), down: Boolean(input.down), left: Boolean(input.left), right: Boolean(input.right), firing: Boolean(input.firing), dash: Boolean(input.dash), angle: Number.isFinite(input.angle) ? normalizeAngle(input.angle) : player.angle };
  });
  socket.on('queue:leave', () => removePlayer(socket.id));
  socket.on('disconnect', () => { const player = findPlayer(socket.id); if (player) { player.socketId = undefined; player.disconnectAt = Date.now(); player.connected = false; } });
});

function humanCount(arena: Arena) { return [...arena.players.values()].filter((player) => !player.isBot).length; }
function findPlayer(socketId: string) { return arenas.flatMap((arena) => [...arena.players.values()]).find((player) => player.socketId === socketId); }
function removePlayer(socketId: string) { for (const arena of arenas) for (const [id, player] of arena.players) if (player.socketId === socketId) arena.players.delete(id); }

function updateBot(bot: Player, arena: Arena, now: number) {
  if (now >= bot.aiThinkAt) {
    bot.aiThinkAt = now + 220 + Math.random() * 180;
    const enemies = [...arena.players.values()].filter((player) => player.id !== bot.id && !player.respawnAt && !player.shielded);
    const nearestEnemy = [...enemies].sort((a, b) => distance(bot, a) + (a.concealed ? 180 : 0) - distance(bot, b) - (b.concealed ? 180 : 0))[0];
    const weakEnemy = [...enemies].sort((a, b) => a.health - b.health || distance(bot, a) - distance(bot, b))[0];
    const nearestDot = [...arena.dots].sort((a, b) => distance(bot, a) - distance(bot, b))[0];
    const edgeRisk = Math.min(bot.x - BOUNDARY, WIDTH - BOUNDARY - bot.x, bot.y - BOUNDARY, HEIGHT - BOUNDARY - bot.y);
    let target: { x: number; y: number; vx?: number; vy?: number } = arena.objective ?? nearestEnemy ?? nearestDot ?? { x: WIDTH / 2, y: HEIGHT / 2 };
    if (bot.personality === 'collector' && nearestDot) target = nearestDot;
    if (bot.personality === 'opportunist' && weakEnemy) target = weakEnemy;
    if ((bot.personality === 'survivor' && bot.health < bot.maxHealth * 0.55) || edgeRisk < 150) target = { x: WIDTH / 2, y: HEIGHT / 2 };
    if (nearestEnemy && bot.personality === 'sniper') { const range = distance(bot, nearestEnemy); const direction = Math.atan2(nearestEnemy.y - bot.y, nearestEnemy.x - bot.x); target = range < 380 ? { x: bot.x - Math.cos(direction) * 260, y: bot.y - Math.sin(direction) * 260 } : nearestEnemy; }
    let moveAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    const nearbyBlock = arena.environment.find((item) => item.solid && distance(bot, item) < Math.max(item.width, item.height)); if (nearbyBlock) moveAngle += Math.PI / 2;
    bot.input.left = Math.cos(moveAngle) < -0.25; bot.input.right = Math.cos(moveAngle) > 0.25; bot.input.up = Math.sin(moveAngle) < -0.25; bot.input.down = Math.sin(moveAngle) > 0.25;
    const aimTarget = nearestEnemy ?? arena.objective; const lead = bot.personality === 'sniper' ? 10 : 6; const error = (Math.random() - .5) * (bot.personality === 'sniper' ? .08 : .2);
    if (aimTarget) bot.aiTargetAngle = Math.atan2(aimTarget.y + ('vy' in aimTarget ? aimTarget.vy * lead : 0) - bot.y, aimTarget.x + ('vx' in aimTarget ? aimTarget.vx * lead : 0) - bot.x) + error;
    const aligned = angleDistance(bot.input.angle, bot.aiTargetAngle) < .16; const fireDelay = bot.personality === 'sniper' ? 520 : bot.personality === 'berserker' ? 280 : 390;
    bot.input.firing = Boolean(aimTarget && distance(bot, aimTarget) < 680 && aligned && now >= bot.aiFireAt); if (bot.input.firing) bot.aiFireAt = now + fireDelay + Math.random() * 180;
    const aggressive = bot.personality === 'hunter' || bot.personality === 'berserker' || bot.personality === 'opportunist'; bot.input.dash = bot.dashCooldown === 0 && (edgeRisk < 110 || Boolean(aggressive && nearestEnemy && distance(bot, nearestEnemy) < 280));
  }
  bot.input.angle = turnToward(bot.input.angle, bot.aiTargetAngle, bot.personality === 'sniper' ? .08 : .11);
}

function updatePlayer(player: Player, arena: Arena, now: number) {
  if (player.respawnAt) { player.respawnIn = Math.max(0, player.respawnAt - now); if (now >= player.respawnAt) completeRespawn(player, arena); else return; }
  if (player.powerUpUntil <= now) player.powerUp = undefined;
  if (player.isBot) updateBot(player, arena, now);
  player.dashCooldown = Math.max(0, player.dashCooldown - TICK_MS); player.fireCooldown = Math.max(0, player.fireCooldown - TICK_MS); player.bumpCooldown = Math.max(0, player.bumpCooldown - TICK_MS);
  if (now < player.staggerUntil) { player.dashing = false; player.vx *= .78; player.vy *= .78; player.x += player.vx; player.y += player.vy; applyBoundaryDamage(player, arena, now); return; }
  const inputX = Number(player.input.right) - Number(player.input.left); const inputY = Number(player.input.down) - Number(player.input.up); const inputLength = Math.hypot(inputX, inputY);
  const directionX = inputLength ? inputX / inputLength : Math.cos(player.angle); const directionY = inputLength ? inputY / inputLength : Math.sin(player.angle);
  if (player.input.dash && player.dashCooldown === 0) { const boost = (20 + player.level * .35) * (player.powerUp === 'bumper' ? 1.15 : 1); player.vx = directionX * boost; player.vy = directionY * boost; player.dashUntil = now + 320; player.dashCooldown = DASH_COOLDOWN; }
  player.dashing = now < player.dashUntil;
  if (!player.dashing) { const speed = Math.min(6.4, 4.6 + (player.level - 1) * 0.13) * (player.powerUp === 'treads' ? 1.08 : 1); const desiredX = inputLength ? directionX * speed : 0; const desiredY = inputLength ? directionY * speed : 0; player.vx += (desiredX - player.vx) * 0.35; player.vy += (desiredY - player.vy) * 0.35; }
  const oldX = player.x; const oldY = player.y; player.x = Math.max(5, Math.min(WIDTH - 5, player.x + player.vx)); player.y = Math.max(5, Math.min(HEIGHT - 5, player.y + player.vy)); resolveEnvironmentCollision(player, arena, oldX, oldY); player.angle = player.input.angle;
  if (player.input.firing && player.fireCooldown === 0) fire(player, arena);
  const dot = arena.dots.find((candidate) => distance(player, candidate) < 30); if (dot) { awardXp(player, dot.value); player.dotsCollected += 1; if (player.dotsCollected % 5 === 0) player.health = Math.min(player.maxHealth, player.health + 10); relocateDot(dot, arena); }
  const pickup = arena.powerUps.find((candidate) => distance(player, candidate) < 38); if (pickup) { player.powerUp = pickup.kind; player.powerUpUntil = now + POWER_UP_DURATION; arena.powerUps = arena.powerUps.filter((candidate) => candidate.id !== pickup.id); }
  player.concealed = arena.environment.some((item) => item.kind === 'bush' && pointInside(player, item));
  applyBoundaryDamage(player, arena, now);
}

function fire(player: Player, arena: Arena) {
  player.fireCooldown = Math.max(240 - (player.level - 1) * 8, 158) * (player.powerUp === 'batteries' ? .9 : 1);
  const speed = 18; arena.bullets.push({ id: randomUUID(), ownerId: player.id, x: player.x + Math.cos(player.angle) * 30, y: player.y + Math.sin(player.angle) * 30, vx: Math.cos(player.angle) * speed, vy: Math.sin(player.angle) * speed, angle: player.angle, color: player.color, ttl: 950, damage: 18 });
  if (player.isBot) player.input.firing = false;
}

function updateBullets(arena: Arena) {
  for (const bullet of arena.bullets) {
    bullet.x += bullet.vx; bullet.y += bullet.vy; bullet.ttl -= TICK_MS;
    if (arena.environment.some((item) => item.solid && pointInside(bullet, item))) { bullet.ttl = 0; continue; }
    if (arena.objective && distance(arena.objective, bullet) < 62) { arena.objective.health -= bullet.damage; const owner = arena.players.get(bullet.ownerId); if (owner) awardXp(owner, 5); bullet.ttl = 0; continue; }
    const target = [...arena.players.values()].find((player) => player.id !== bullet.ownerId && !player.respawnAt && !player.shielded && distance(player, bullet) < 24);
    if (target) { const owner = arena.players.get(bullet.ownerId); target.health -= bullet.damage * (target.powerUp === 'reinforced' ? .9 : 1); target.lastHitBy = bullet.ownerId; target.lastHitAt = Date.now(); bullet.ttl = 0; if (owner) awardXp(owner, 8); if (target.health <= 0) defeat(target, arena, 'shot', bullet.ownerId); }
  }
  arena.bullets = arena.bullets.filter((bullet) => bullet.ttl > 0 && bullet.x > 0 && bullet.x < WIDTH && bullet.y > 0 && bullet.y < HEIGHT);
}

function resolveBumps(arena: Arena) {
  const players = [...arena.players.values()].filter((player) => !player.respawnAt);
  for (let firstIndex = 0; firstIndex < players.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < players.length; secondIndex += 1) {
    const first = players[firstIndex]; const second = players[secondIndex]; let dx = second.x - first.x; let dy = second.y - first.y; const distanceBetween = Math.hypot(dx, dy);
    if (distanceBetween >= 44) continue; if (distanceBetween === 0) { dx = 1; dy = 0; } else { dx /= distanceBetween; dy /= distanceBetween; }
    const firstMomentum = Math.hypot(first.vx, first.vy) * (first.dashing ? 2.4 : 1) * (first.powerUp === 'bumper' ? 1.15 : 1); const secondMomentum = Math.hypot(second.vx, second.vy) * (second.dashing ? 2.4 : 1) * (second.powerUp === 'bumper' ? 1.15 : 1); const totalMomentum = Math.max(4, firstMomentum + secondMomentum);
    const push = (44 - distanceBetween) / 2 + totalMomentum * .85; first.x -= dx * push; first.y -= dy * push; second.x += dx * push; second.y += dy * push;
    if (firstMomentum > secondMomentum) { second.vx += dx * firstMomentum; second.vy += dy * firstMomentum; second.lastHitBy = first.id; second.lastHitAt = Date.now(); if (first.dashing) second.staggerUntil = Date.now() + staggerDuration(firstMomentum, second); }
    else { first.vx -= dx * secondMomentum; first.vy -= dy * secondMomentum; first.lastHitBy = second.id; first.lastHitAt = Date.now(); if (second.dashing) first.staggerUntil = Date.now() + staggerDuration(secondMomentum, first); }
    if (first.bumpCooldown === 0 && second.bumpCooldown === 0) { const damage = Math.min(14, Math.max(1, Math.floor(totalMomentum / 3))); first.health -= damage; second.health -= damage; first.bumpCooldown = 350; second.bumpCooldown = 350; if (first.health <= 0) defeat(first, arena, 'bump', first.lastHitBy); if (second.health <= 0) defeat(second, arena, 'bump', second.lastHitBy); }
  }
}

function applyBoundaryDamage(player: Player, arena: Arena, now: number) {
  const outside = player.x < BOUNDARY || player.x > WIDTH - BOUNDARY || player.y < BOUNDARY || player.y > HEIGHT - BOUNDARY;
  if (!outside) { player.outsideSince = undefined; return; }
  player.outsideSince ??= now; const exposure = now - player.outsideSince; const damage = exposure < 1000 ? 1 : exposure < 2500 ? 3 : 7;
  if (!player.shielded) player.health -= damage;
  if (player.health <= 0) { const recentAttacker = player.lastHitAt && now - player.lastHitAt < 5000 ? player.lastHitBy : undefined; defeat(player, arena, 'ringout', recentAttacker); }
}

function resolveEnvironmentCollision(player: Player, arena: Arena, oldX: number, oldY: number) {
  const collision = arena.environment.find((item) => item.solid && player.x + 20 > item.x && player.x - 20 < item.x + item.width && player.y + 20 > item.y && player.y - 20 < item.y + item.height);
  if (!collision) return; player.x = oldX; player.y = oldY; player.vx *= -.2; player.vy *= -.2;
}

function relocateDot(dot: DotSnapshot, arena: Arena) { for (let attempt = 0; attempt < 20; attempt += 1) { Object.assign(dot, makeDot(dot.id)); if (arena.environment.every((item) => !item.solid || !pointInside(dot, item))) return; } }

function updateObjective(arena: Arena, now: number) {
  arena.powerUps = arena.powerUps.filter((powerUp) => powerUp.expiresAt > now);
  if (arena.objective && (arena.objective.health <= 0 || arena.objective.activeUntil <= now)) {
    if (arena.objective.health <= 0) { const kinds: PowerUpKind[] = ['reinforced', 'batteries', 'treads', 'bumper', 'shocks']; arena.powerUps.push({ id: randomUUID(), x: arena.objective.x, y: arena.objective.y, kind: kinds[Math.floor(Math.random() * kinds.length)], expiresAt: now + 30000 }); }
    arena.objective = undefined; arena.nextObjectiveAt = now + OBJECTIVE_INTERVAL;
  }
  if (!arena.objective && now >= arena.nextObjectiveAt) arena.objective = { id: randomUUID(), x: WIDTH / 2, y: HEIGHT / 2, health: 1200, maxHealth: 1200, activeUntil: now + 120000 };
}

function pointInside(point: { x: number; y: number }, item: EnvironmentSnapshot) { return point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height; }
function normalizeAngle(angle: number) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function turnToward(current: number, target: number, maximumStep: number) { const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current)); return normalizeAngle(current + Math.max(-maximumStep, Math.min(maximumStep, difference))); }
function staggerDuration(momentum: number, target: Player) { const base = momentum > 34 ? 600 : momentum > 24 ? 400 : 250; return base * (target.powerUp === 'shocks' ? .65 : 1); }
function distance(first: { x: number; y: number }, second: { x: number; y: number }) { return Math.hypot(first.x - second.x, first.y - second.y); }
function angleDistance(first: number, second: number) { return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second))); }

setInterval(() => {
  const now = Date.now();
  for (const arena of arenas) {
    addBots(arena);
    for (const [id, player] of arena.players) { if (player.disconnectAt && now - player.disconnectAt > 30000) { arena.players.delete(id); continue; } updatePlayer(player, arena, now); }
    resolveBumps(arena); updateBullets(arena); updateObjective(arena, now); io.to(roomFor(arena)).emit('arena:state', snapshot(arena));
  }
}, TICK_MS);

httpServer.listen(PORT, () => console.log(`Dot Tank server listening on http://localhost:${PORT}`));
