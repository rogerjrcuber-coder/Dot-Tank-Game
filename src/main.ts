import { io, type Socket } from 'socket.io-client';
import { validateNickname } from '../shared/profanity.ts';
import type { ArenaSnapshot, PlayerColor, PlayerInput, PlayerSnapshot } from '../shared/types.ts';
import '@fontsource/press-start-2p/latin-400.css';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const colors: PlayerColor[] = ['pink', 'cyan', 'lime', 'orange', 'violet', 'yellow'];
const colorValues: Record<PlayerColor, string> = { pink: '#f1444d', cyan: '#7195be', lime: '#b0ed13', orange: '#bd7f59', violet: '#980019', yellow: '#f3e4ad' };
const storedName = sessionStorage.getItem('dot-tank-name') ?? '';
const storedColor = (sessionStorage.getItem('dot-tank-color') as PlayerColor | null) ?? 'pink';
sessionStorage.removeItem('dot-tank-token');
const input: PlayerInput = { up: false, down: false, left: false, right: false, firing: false, dash: false, angle: 0 };
const state = { socket: null as Socket | null, snapshot: null as ArenaSnapshot | null, playerId: '', token: '', connected: false, input };
const usesTouchControls = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 700;
document.documentElement.classList.toggle('touch-ui', usesTouchControls);
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
const particles: Particle[] = [];
const previousHealth = new Map<string, number>();

app.innerHTML = `<main class="shell"><section id="lobby" class="lobby"><div class="panel"><div class="eyebrow">DOT TANK ARENA <span class="live-dot"></span> ONLINE</div><h1>BACKYARD<br><span>BLITZ</span></h1><p class="lede">Pocket-sized armor. Backyard-sized battles. Collect dots, build your tank, and rule the lawn.</p><div class="form-row"><label>CALLSIGN<input id="name" maxlength="16" placeholder="PICK A CALLSIGN" autocomplete="off"></label><label>COLOR<div id="colors" class="color-picker"></div></label></div><button id="play" class="primary">DEPLOY TANK <span>&gt;&gt;</span></button><p id="error" class="error"></p><div class="rules"><div><strong>WASD</strong><span>MOVE</span></div><div><strong>MOUSE</strong><span>AIM + FIRE</span></div><div><strong>SPACE</strong><span>DASH / BUMP</span></div></div></div><div class="hero-art" aria-hidden="true"><div class="sun-pixel"></div><svg class="iso-tank" viewBox="0 0 640 500" role="img"><g shape-rendering="crispEdges"><path class="tank-shadow" d="M112 340 300 245 530 335 337 438Z"/><path class="track-left" d="M120 286 292 205 292 296 120 379Z"/><path class="track-right" d="M292 296 520 373 520 292 292 205Z"/><path class="track-top" d="M120 286 292 205 520 292 345 374Z"/><path class="body-left" d="M168 239 310 171 310 275 168 341Z"/><path class="body-right" d="M310 275 470 329 470 226 310 171Z"/><path class="body-top" d="M168 239 310 171 470 226 326 294Z"/><path class="turret-left" d="M248 172 329 133 329 206 248 245Z"/><path class="turret-right" d="M329 206 410 232 410 160 329 133Z"/><path class="turret-top" d="M248 172 329 133 410 160 329 201Z"/><path class="barrel-side" d="M389 156 502 101 526 111 410 169Z"/><path class="barrel-top" d="M381 146 494 92 526 103 410 160Z"/><path class="hatch" d="M292 144 330 125 370 139 331 158Z"/><path class="track-mark" d="M137 300 275 235 275 250 137 316ZM137 332 275 267 275 282 137 348ZM315 316 497 378 497 360 315 299Z"/><path class="shine" d="M197 238 307 186 375 209 264 261Z"/></g></svg><div class="hero-copy"><b>FIVE ARENAS</b><span>ONE TINY WAR</span></div></div></section><section id="game" class="game hidden"><canvas id="arena"></canvas><div class="hud"><div class="hud-left"><div class="brand">DOT TANK <span>LIVE</span></div><div id="dash-meter" class="dash-meter"><b>DASH</b><i></i></div><div id="power" class="power"></div><div id="event" class="event"></div><div id="warning" class="warning"></div><canvas id="minimap" class="minimap" width="180" height="116"></canvas></div><div id="status" class="status">CONNECTING</div><div><div id="leaderboard" class="leaderboard"></div><div id="kill-feed" class="kill-feed"></div></div></div><div class="mobile-controls"><div id="stick" class="stick" aria-label="Move"><i></i></div><div id="aim-stick" class="aim-stick" aria-label="Aim"><i></i></div><button id="dash" class="dash">DASH</button><div class="auto-fire">AUTO FIRE</div></div><div id="respawn" class="respawn hidden"></div><div id="toast" class="toast"></div></section></main>`;

const titleTank = document.querySelector<SVGSVGElement>('.iso-tank')!;
titleTank.innerHTML = `<g shape-rendering="crispEdges">
  <path class="tank-shadow" d="M82 350 304 236 559 321 333 446Z"/>
  <path class="track-left" d="M112 295 337 370 337 427 112 345Z"/>
  <path class="track-right" d="M337 370 536 279 536 337 337 427Z"/>
  <path class="track-top" d="M112 295 305 208 536 279 337 370Z"/>
  <path class="wheel" d="M143 327 179 339 179 372 143 359ZM195 345 231 357 231 390 195 377ZM247 363 283 375 283 407 247 395ZM371 367 405 351 405 385 371 401ZM422 344 456 328 456 362 422 378ZM473 320 507 304 507 338 473 354Z"/>
  <path class="body-left" d="M132 255 340 323 340 379 132 306Z"/>
  <path class="body-right" d="M340 323 514 244 514 300 340 379Z"/>
  <path class="body-top" d="M132 255 304 178 514 244 340 323Z"/>
  <path class="barrel-side" d="M80 239 265 184 286 198 102 260 80 253Z"/>
  <path class="barrel-top" d="M80 226 265 171 286 184 102 246 80 239Z"/>
  <path class="turret-left" d="M225 170 339 207 339 259 225 220Z"/>
  <path class="turret-right" d="M339 207 448 158 448 209 339 259Z"/>
  <path class="turret-top" d="M225 170 332 123 448 158 339 207Z"/>
  <path class="hatch" d="M282 125 338 101 397 119 339 145Z"/>
  <path class="shine" d="M159 248 301 185 423 223 280 288Z"/>
  <path class="track-mark" d="M123 310 325 378 325 390 123 319ZM353 377 520 301 520 313 353 390Z"/>
</g>`;

const colorPicker = document.querySelector<HTMLDivElement>('#colors')!;
let selectedColor: PlayerColor = colors.includes(storedColor) ? storedColor : 'pink';
const nameInput = document.querySelector<HTMLInputElement>('#name')!; nameInput.value = storedName;
colorPicker.innerHTML = colors.map((color) => `<button class="swatch ${color}" data-color="${color}" aria-label="${color}"></button>`).join('');
colorPicker.querySelector(`[data-color="${selectedColor}"]`)?.classList.add('selected');
colorPicker.addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color]'); if (!button) return; selectedColor = button.dataset.color as PlayerColor; colorPicker.querySelectorAll('.swatch').forEach((swatch) => swatch.classList.toggle('selected', swatch === button)); });

const errorElement = document.querySelector<HTMLParagraphElement>('#error')!;
document.querySelector('#play')!.addEventListener('click', joinArena);
nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinArena(); });
function joinArena() { const result = validateNickname(nameInput.value); if (!result.ok) { errorElement.textContent = result.error; return; } errorElement.textContent = ''; sessionStorage.setItem('dot-tank-name', result.value); sessionStorage.setItem('dot-tank-color', selectedColor); connect(result.value); }

function connect(name: string) {
  const productionServer = 'https://dot-tank-game-production.up.railway.app';
  const serverUrl = import.meta.env.VITE_SERVER_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : productionServer);
  state.socket?.disconnect(); state.socket = io(serverUrl, { transports: ['websocket', 'polling'], reconnection: true });
  state.socket.on('connect', () => { state.connected = true; errorElement.textContent = ''; if (state.token) state.socket!.emit('player:reconnect', { token: state.token }); else state.socket!.emit('queue:join', { name, color: selectedColor }); });
  state.socket.on('connect_error', () => { errorElement.textContent = 'ARENA SERVER UNREACHABLE. RETRYING...'; });
  state.socket.on('session:ready', (data) => { state.token = data.token; state.playerId = data.playerId; document.querySelector('#lobby')!.classList.add('hidden'); document.querySelector('#game')!.classList.remove('hidden'); });
  state.socket.on('arena:state', (snapshot: ArenaSnapshot) => { createDamageParticles(snapshot); state.snapshot = snapshot; updateMobileAutoFire(snapshot); renderHud(); });
  state.socket.on('player:error', (data) => { if (state.token && data.message.includes('expired')) { state.token = ''; state.socket!.emit('queue:join', { name, color: selectedColor }); return; } errorElement.textContent = data.message; });
  state.socket.on('disconnect', () => { state.connected = false; showToast('CONNECTION LOST // RECONNECTING'); });
}

function renderHud() {
  if (!state.snapshot) return; const me = state.snapshot.players.find((player) => player.id === state.playerId);
  document.querySelector('#status')!.textContent = me ? `ARENA ${String(state.snapshot.arenaId + 1).padStart(2, '0')} // ${state.snapshot.online} HUMAN + ${state.snapshot.bots} BOTS` : 'SYNCING';
  const rows = [...state.snapshot.players].sort((a, b) => b.xp - a.xp || b.eliminations - a.eliminations).slice(0, 10).map((player, index) => `<div class="rank ${player.id === state.playerId ? 'me' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><i class="mini ${player.color}"></i><span>${escapeHtml(player.name)}<small>${player.xp} XP // ${player.eliminations}K ${player.deaths}D</small></span><em>L${player.level}</em></div>`).join('');
  document.querySelector('#leaderboard')!.innerHTML = `<h3>ARENA RANKING</h3>${rows}`;
  document.querySelector('#kill-feed')!.innerHTML = state.snapshot.killFeed.slice().reverse().map((item) => `<p><b>${escapeHtml(item.attacker)}</b> ${item.cause === 'ringout' ? 'RANG OUT' : item.cause === 'bump' ? 'CRUSHED' : 'BLASTED'} <b>${escapeHtml(item.victim)}</b></p>`).join('');
  if (me) {
    const dashReady = 1 - Math.min(1, me.dashCooldown / 2600); (document.querySelector('#dash-meter i') as HTMLElement).style.width = `${dashReady * 100}%`;
    const outside = me.x < state.snapshot.boundary || me.x > state.snapshot.width - state.snapshot.boundary || me.y < state.snapshot.boundary || me.y > state.snapshot.height - state.snapshot.boundary;
    document.querySelector('#warning')!.textContent = outside ? '!! RETURN TO THE COMBAT ZONE !!' : '';
    document.querySelector('#power')!.textContent = me.powerUp ? `${me.powerUp.toUpperCase()} // ${Math.ceil(me.powerUpIn / 1000)}S` : '';
    document.querySelector('#event')!.textContent = state.snapshot.objective ? `SANDCASTLE // ${Math.ceil(state.snapshot.objective.health)} HP` : `NEXT CASTLE // ${formatTime(state.snapshot.nextObjectiveIn)}`;
    const respawn = document.querySelector('#respawn')!; respawn.classList.toggle('hidden', me.respawnIn === 0); respawn.textContent = me.respawnIn ? `REBOOTING // ${(me.respawnIn / 1000).toFixed(1)}` : '';
    drawMinimap(state.snapshot, me);
  }
}

function createDamageParticles(snapshot: ArenaSnapshot) {
  for (const player of snapshot.players) { const oldHealth = previousHealth.get(player.id); if (oldHealth !== undefined && oldHealth > player.health) burst(player.x, player.y, colorValues[player.color], player.health === 0 ? 18 : 6); previousHealth.set(player.id, player.health); }
}
function burst(x: number, y: number, color: string, count: number) { for (let index = 0; index < count; index += 1) particles.push({ x, y, vx: (Math.random() - .5) * 12, vy: (Math.random() - .5) * 12, life: 450 + Math.random() * 300, color: index % 3 ? color : '#fff3a6', size: 3 + Math.floor(Math.random() * 4) }); }
function escapeHtml(value: string) { const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }; return value.replace(/[&<>"']/g, (character) => entities[character]); }
function showToast(message: string) { const toast = document.querySelector('#toast')!; toast.textContent = message; toast.classList.add('show'); window.setTimeout(() => toast.classList.remove('show'), 2500); }
function formatTime(milliseconds: number) { const seconds = Math.ceil(milliseconds / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function updateMobileAutoFire(snapshot: ArenaSnapshot) { if (!usesTouchControls) return; const me = snapshot.players.find((player) => player.id === state.playerId); state.input.firing = Boolean(me && !me.respawnIn && snapshot.players.some((player) => player.id !== me.id && !player.respawnIn && player.health > 0 && Math.hypot(player.x - me.x, player.y - me.y) <= 340)); }

const canvas = document.querySelector<HTMLCanvasElement>('#arena')!; const context = canvas.getContext('2d', { alpha: false })!; context.imageSmoothingEnabled = false;
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; canvas.style.width = `${window.innerWidth}px`; canvas.style.height = `${window.innerHeight}px`; context.imageSmoothingEnabled = false; } window.addEventListener('resize', resize); resize();

function draw() {
  const width = canvas.width; const height = canvas.height; context.fillStyle = '#07140d'; context.fillRect(0, 0, width, height);
  if (state.snapshot) {
    const me = state.snapshot.players.find((player) => player.id === state.playerId); const scale = Math.max(.55, Math.min(1, Math.min(width / 1050, height / 720))); const cameraX = me?.x ?? state.snapshot.width / 2; const cameraY = me?.y ?? state.snapshot.height / 2; const shake = me?.dashing ? 4 : 0; const ox = Math.round(width / 2 - cameraX * scale + (Math.random() - .5) * shake); const oy = Math.round(height / 2 - cameraY * scale + (Math.random() - .5) * shake);
    context.save(); context.translate(ox, oy); context.scale(scale, scale); drawArena(state.snapshot);
    for (const item of state.snapshot.environment) drawEnvironment(item);
    for (const dot of state.snapshot.dots) drawDot(dot.x, dot.y);
    if (state.snapshot.objective) drawObjective(state.snapshot.objective.x, state.snapshot.objective.y, state.snapshot.objective.health / state.snapshot.objective.maxHealth);
    for (const powerUp of state.snapshot.powerUps) drawPowerUp(powerUp.x, powerUp.y, powerUp.kind);
    for (const bullet of state.snapshot.bullets) { const direction = direction8(bullet.angle); const bx = Math.round(bullet.x); const by = Math.round(bullet.y); context.fillStyle = colorValues[bullet.color]; context.fillRect(bx - direction.x * 5 - 3, by - direction.y * 5 - 3, 6, 6); context.fillStyle = '#fff7c2'; context.fillRect(bx - 3, by - 3, 7, 7); context.fillStyle = '#ffffff'; context.fillRect(bx, by - 2, 3, 3); }
    for (const player of state.snapshot.players) drawTank(player);
    updateParticles(); context.restore();
  }
  requestAnimationFrame(draw);
}

function drawArena(snapshot: ArenaSnapshot) {
  context.fillStyle = '#1fb34d'; context.fillRect(0, 0, snapshot.width, snapshot.height);
  context.fillStyle = '#11542a'; for (let y = 36; y < snapshot.height; y += 128) for (let x = (y / 2) % 160; x < snapshot.width; x += 190) { context.fillRect(x, y, 9, 24); context.fillRect(x + 9, y - 8, 8, 12); }
  for (const line of [[100, 120, 3080, 2120], [420, 110, 140, 880], [930, 110, 240, 1100], [1570, 110, 680, 2090], [2100, 110, 1500, 2090], [2570, 110, 2080, 2090], [3190, 110, 2670, 2090], [120, 930, 1450, 2090], [120, 1510, 930, 2090], [650, 110, 3280, 760]] as const) drawPixelLine(line[0], line[1], line[2], line[3], '#b0ed13', 9);
  const cx = snapshot.width / 2; const cy = snapshot.height / 2; context.fillStyle = '#36241b'; context.beginPath(); context.moveTo(cx - 410, cy - 290); context.lineTo(cx + 390, cy - 220); context.lineTo(cx + 330, cy + 270); context.lineTo(cx - 470, cy + 210); context.closePath(); context.fill(); context.fillStyle = '#f3e4ad'; context.beginPath(); context.moveTo(cx - 392, cy - 267); context.lineTo(cx + 367, cy - 201); context.lineTo(cx + 310, cy + 246); context.lineTo(cx - 446, cy + 190); context.closePath(); context.fill(); context.fillStyle = '#bd7f59'; context.fillRect(cx - 175, cy - 100, 350, 190);
  context.fillStyle = '#660012'; context.fillRect(snapshot.boundary - 10, snapshot.boundary - 10, snapshot.width - snapshot.boundary * 2 + 20, 10); context.fillRect(snapshot.boundary - 10, snapshot.height - snapshot.boundary, snapshot.width - snapshot.boundary * 2 + 20, 10); context.fillRect(snapshot.boundary - 10, snapshot.boundary, 10, snapshot.height - snapshot.boundary * 2); context.fillRect(snapshot.width - snapshot.boundary, snapshot.boundary, 10, snapshot.height - snapshot.boundary * 2);
}

function drawPixelLine(x0: number, y0: number, x1: number, y1: number, color: string, pixel: number) { const dx = x1 - x0; const dy = y1 - y0; const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / pixel)); context.fillStyle = color; for (let step = 0; step <= steps; step += 1) context.fillRect(Math.round((x0 + dx * step / steps) / pixel) * pixel, Math.round((y0 + dy * step / steps) / pixel) * pixel, pixel, pixel); }

function drawDot(x: number, y: number) { context.fillStyle = '#9b6e22'; context.fillRect(Math.round(x) - 7, Math.round(y) - 7, 14, 14); context.fillStyle = '#ffd85c'; context.fillRect(Math.round(x) - 5, Math.round(y) - 5, 10, 10); context.fillStyle = '#fff3a6'; context.fillRect(Math.round(x) - 3, Math.round(y) - 3, 4, 4); }
function drawEnvironment(item: ArenaSnapshot['environment'][number]) {
  const palettes = { brick: ['#f91b24','#b41218'], rock: ['#aaaaaa','#555555'], branch: ['#bd7f59','#5b3d2c'], bush: ['#167635','#0b371c'], flower: ['#b0ed13','#506b09'], dirt: ['#bd7f59','#875b41'], gravel: ['#f3e4ad','#736c54'] } as const; const palette = palettes[item.kind];
  context.fillStyle = palette[1]; context.fillRect(item.x, item.y + 8, item.width, item.height); context.fillStyle = palette[0];
  if (item.kind === 'brick') { context.fillRect(item.x + 8, item.y + 8, item.width - 16, item.height - 18); for (let x = item.x + 12; x < item.x + item.width - 35; x += 118) context.fillRect(x, item.y - 22, 72, 42); context.fillStyle = '#f1444d'; context.fillRect(item.x + 18, item.y + item.height / 2, item.width - 36, 9); }
  else if (item.kind === 'rock') { context.fillRect(item.x + 24, item.y, item.width - 48, item.height); context.fillRect(item.x + 8, item.y + 22, item.width - 16, item.height - 38); context.fillStyle = '#858585'; for (let x = 35; x < item.width - 30; x += 90) context.fillRect(item.x + x, item.y + 18 + (x % 3) * 7, Math.min(56, item.width - x), 18); }
  else if (item.kind === 'bush') { context.fillRect(item.x + 22, item.y + 18, item.width - 44, item.height - 24); context.fillRect(item.x + 4, item.y + 55, item.width - 8, item.height - 82); context.fillRect(item.x + 48, item.y, item.width - 96, item.height); context.fillStyle = '#1f8d3f'; for (let y = 30; y < item.height - 20; y += 48) for (let x = 30 + (y % 60); x < item.width - 20; x += 64) context.fillRect(item.x + x, item.y + y, 22, 20); }
  else if (item.kind === 'flower' || item.kind === 'gravel' || item.kind === 'dirt') { context.fillRect(item.x, item.y, item.width, item.height); for (let y = 8; y < item.height; y += 18) for (let x = 8; x < item.width; x += 22) { context.fillStyle = palette[(x + y) % 3 ? 0 : 1]; context.fillRect(item.x + x, item.y + y, item.kind === 'flower' ? 5 : 7, item.kind === 'flower' ? 5 : 4); } }
  else { for (let x = 5; x < item.width; x += 24) context.fillRect(item.x + x, item.y + 5, 16, Math.max(6, item.height - 10)); }
}
function drawObjective(x: number, y: number, health: number) { context.fillStyle = '#8d552f'; context.fillRect(x - 58, y - 32, 116, 64); context.fillStyle = '#e8bd69'; context.fillRect(x - 52, y - 27, 104, 54); for (const tower of [-42, 0, 42]) { context.fillRect(x + tower - 13, y - 51, 26, 28); context.fillStyle = '#8d552f'; context.fillRect(x + tower - 13, y - 54, 7, 8); context.fillRect(x + tower + 6, y - 54, 7, 8); context.fillStyle = '#e8bd69'; } context.fillStyle = '#361a18'; context.fillRect(x - 50, y + 39, 100, 8); context.fillStyle = '#ffd85c'; context.fillRect(x - 50, y + 39, 100 * health, 8); }
function drawPowerUp(x: number, y: number, kind: string) { context.fillStyle = '#fff'; context.fillRect(x - 16, y - 16, 32, 32); context.fillStyle = '#7195be'; context.fillRect(x - 12, y - 12, 24, 24); context.fillStyle = '#000'; context.font = '10px "Press Start 2P"'; context.textAlign = 'center'; context.fillText(kind[0].toUpperCase(), x, y + 5); }
const directions8 = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }] as const;
function direction8(angle: number) { const safeAngle = Number.isFinite(angle) ? angle : 0; const rawIndex = Math.round(safeAngle / (Math.PI / 4)); const index = ((rawIndex % directions8.length) + directions8.length) % directions8.length; return directions8[index] ?? directions8[0]; }
function drawTank(player: PlayerSnapshot) {
  if (player.respawnIn) return; const color = colorValues[player.color]; const x = Math.round(player.x); const y = Math.round(player.y); const turret = direction8(player.angle);
  context.save(); context.globalAlpha = player.concealed && player.id !== state.playerId ? .48 : 1; context.translate(x, y); if (player.dashing) { context.fillStyle = '#ffffff'; context.fillRect(-28 - Math.sign(player.vx) * 8, -14, 8, 6); context.fillRect(-30 - Math.sign(player.vx) * 5, 7, 6, 5); }
  context.fillStyle = '#000'; context.fillRect(-18, -15, 36, 7); context.fillRect(-18, 8, 36, 7); context.fillStyle = '#858585'; for (let track = -14; track <= 10; track += 8) { context.fillRect(track, -13, 5, 3); context.fillRect(track, 10, 5, 3); }
  context.fillStyle = color; context.fillRect(-15, -9, 30, 18); context.fillStyle = '#101827'; context.fillRect(-9, -6, 18, 12); context.fillStyle = '#e8edf5'; context.fillRect(-4, -3, 8, 6);
  context.fillStyle = '#101827'; context.fillRect(-6, -6, 12, 12); context.fillStyle = color; for (let step = 1; step <= 4; step += 1) context.fillRect(turret.x * step * 5 - 4, turret.y * step * 5 - 4, 8, 8); context.fillStyle = '#fff7c2'; context.fillRect(turret.x * 23 - 3, turret.y * 23 - 3, 7, 7); context.restore();
  if (player.staggeredIn) { context.fillStyle = '#ffd85c'; context.fillRect(x - 13, y - 33, 6, 6); context.fillRect(x + 5, y - 37, 6, 6); }
  if (player.shielded) { context.strokeStyle = '#7ffcff'; context.lineWidth = 3; context.strokeRect(x - 25, y - 24, 50, 48); }
  context.textAlign = 'center'; context.font = '9px "Press Start 2P"'; context.fillStyle = '#000'; context.fillText(`${player.name} L${player.level}`, x + 2, y - 27); context.fillStyle = '#fff'; context.fillText(`${player.name} L${player.level}`, x, y - 29); context.fillStyle = '#980019'; context.fillRect(x - 25, y + 22, 50, 5); context.fillStyle = color; context.fillRect(x - 25, y + 22, Math.max(0, 50 * player.health / player.maxHealth), 5);
}
function drawMinimap(snapshot: ArenaSnapshot, me: PlayerSnapshot) { const minimap = document.querySelector<HTMLCanvasElement>('#minimap')!; const map = minimap.getContext('2d')!; map.imageSmoothingEnabled = false; map.fillStyle = '#07101a'; map.fillRect(0, 0, minimap.width, minimap.height); const sx = minimap.width / snapshot.width; const sy = minimap.height / snapshot.height; map.strokeStyle = '#ff4fa3'; map.lineWidth = 2; map.strokeRect(snapshot.boundary * sx, snapshot.boundary * sy, (snapshot.width - snapshot.boundary * 2) * sx, (snapshot.height - snapshot.boundary * 2) * sy); for (const item of snapshot.environment) { if (!item.solid) continue; map.fillStyle = '#667085'; map.fillRect(item.x * sx, item.y * sy, Math.max(2, item.width * sx), Math.max(2, item.height * sy)); } if (snapshot.objective) { map.fillStyle = '#ffd85c'; map.fillRect(snapshot.objective.x * sx - 3, snapshot.objective.y * sy - 3, 7, 7); } map.fillStyle = '#fff'; map.fillRect(me.x * sx - 2, me.y * sy - 2, 5, 5); }
function updateParticles() { for (let index = particles.length - 1; index >= 0; index -= 1) { const particle = particles[index]; particle.x += particle.vx; particle.y += particle.vy; particle.vx *= .91; particle.vy *= .91; particle.life -= 16; context.fillStyle = particle.color; context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size); if (particle.life <= 0) particles.splice(index, 1); } }
draw();

function setMovement(key: string, pressed: boolean) { if (key === 'w' || key === 'arrowup') state.input.up = pressed; if (key === 's' || key === 'arrowdown') state.input.down = pressed; if (key === 'a' || key === 'arrowleft') state.input.left = pressed; if (key === 'd' || key === 'arrowright') state.input.right = pressed; }
window.addEventListener('keydown', (event) => { setMovement(event.key.toLowerCase(), true); if (event.code === 'Space') { state.input.dash = true; event.preventDefault(); } });
window.addEventListener('keyup', (event) => { setMovement(event.key.toLowerCase(), false); if (event.code === 'Space') state.input.dash = false; });
window.addEventListener('mousemove', (event) => { state.input.angle = Math.atan2(event.clientY - window.innerHeight / 2, event.clientX - window.innerWidth / 2); });
window.addEventListener('mousedown', () => { state.input.firing = true; }); window.addEventListener('mouseup', () => { state.input.firing = false; });
window.addEventListener('blur', () => { state.input.up = false; state.input.down = false; state.input.left = false; state.input.right = false; state.input.firing = false; state.input.dash = false; });

const stick = document.querySelector<HTMLDivElement>('#stick')!; const aimStick = document.querySelector<HTMLDivElement>('#aim-stick')!; const dash = document.querySelector<HTMLButtonElement>('#dash')!;
function moveTouch(event: TouchEvent) { const touch = event.touches[0]; if (!touch) return; const rect = stick.getBoundingClientRect(); const dx = touch.clientX - (rect.left + rect.width / 2); const dy = touch.clientY - (rect.top + rect.height / 2); state.input.left = dx < -12; state.input.right = dx > 12; state.input.up = dy < -12; state.input.down = dy > 12; const distance = Math.max(1, Math.hypot(dx, dy)); const reach = Math.min(24, distance); (stick.firstElementChild as HTMLElement).style.transform = `translate(${dx / distance * reach}px,${dy / distance * reach}px)`; event.preventDefault(); }
stick.addEventListener('touchstart', moveTouch, { passive: false }); stick.addEventListener('touchmove', moveTouch, { passive: false });
stick.addEventListener('touchend', () => { state.input.up = false; state.input.down = false; state.input.left = false; state.input.right = false; (stick.firstElementChild as HTMLElement).style.transform = ''; });
function aimTouch(event: TouchEvent) { const touch = event.touches[0]; if (!touch) return; const rect = aimStick.getBoundingClientRect(); const dx = touch.clientX - (rect.left + rect.width / 2); const dy = touch.clientY - (rect.top + rect.height / 2); state.input.angle = Math.atan2(dy, dx); const distance = Math.max(1, Math.hypot(dx, dy)); const reach = Math.min(24, distance); (aimStick.firstElementChild as HTMLElement).style.transform = `translate(${dx / distance * reach}px,${dy / distance * reach}px)`; event.preventDefault(); }
aimStick.addEventListener('touchstart', aimTouch, { passive: false }); aimStick.addEventListener('touchmove', aimTouch, { passive: false }); aimStick.addEventListener('touchend', () => { (aimStick.firstElementChild as HTMLElement).style.transform = ''; });
dash.addEventListener('pointerdown', () => { state.input.dash = true; }); dash.addEventListener('pointerup', () => { state.input.dash = false; });
window.setInterval(() => { if (state.connected) state.socket?.emit('player:input', state.input); }, 50);
