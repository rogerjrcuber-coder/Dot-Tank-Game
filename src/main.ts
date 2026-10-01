import { io, type Socket } from 'socket.io-client';
import { validateNickname } from '../shared/profanity.ts';
import type { ArenaSnapshot, PlayerColor, PlayerInput, PlayerSnapshot } from '../shared/types.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const colors: PlayerColor[] = ['pink', 'cyan', 'lime', 'orange', 'violet', 'yellow'];
const colorValues: Record<PlayerColor, string> = { pink: '#ff4fa3', cyan: '#4de8e8', lime: '#b8f34a', orange: '#ff914d', violet: '#ad7aff', yellow: '#ffd85c' };
const storedToken = sessionStorage.getItem('dot-tank-token') ?? '';
const storedName = sessionStorage.getItem('dot-tank-name') ?? '';
const storedColor = (sessionStorage.getItem('dot-tank-color') as PlayerColor | null) ?? 'pink';
const input: PlayerInput = { up: false, down: false, left: false, right: false, firing: false, dash: false, angle: 0 };
const state = { socket: null as Socket | null, snapshot: null as ArenaSnapshot | null, playerId: '', token: storedToken, connected: false, input };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
const particles: Particle[] = [];
const previousHealth = new Map<string, number>();

app.innerHTML = `<main class="shell"><section id="lobby" class="panel lobby"><div class="eyebrow">DOT TANK ARENA <span class="live-dot"></span> ONLINE</div><h1>OWN THE<br><span>PIXEL PIT.</span></h1><p class="lede">Dash. Blast. Body-check. Push rivals through the energy wall and climb the arena board.</p><div class="form-row"><label>CALLSIGN<input id="name" maxlength="16" placeholder="PICK A CALLSIGN" autocomplete="off"></label><label>COLOR<div id="colors" class="color-picker"></div></label></div><button id="play" class="primary">DROP INTO BATTLE <span>&gt;&gt;</span></button><p id="error" class="error"></p><div class="rules"><div><strong>WASD</strong><span>MOVE</span></div><div><strong>MOUSE</strong><span>AIM + FIRE</span></div><div><strong>SPACE</strong><span>DASH / BUMP</span></div></div></section><section id="game" class="game hidden"><canvas id="arena"></canvas><div class="hud"><div class="hud-left"><div class="brand">DOT TANK <span>LIVE</span></div><div id="dash-meter" class="dash-meter"><b>DASH</b><i></i></div><div id="warning" class="warning"></div></div><div id="status" class="status">CONNECTING</div><div><div id="leaderboard" class="leaderboard"></div><div id="kill-feed" class="kill-feed"></div></div></div><div class="mobile-controls"><div id="stick" class="stick"><i></i></div><button id="dash" class="dash">DASH</button><button id="fire" class="fire">FIRE</button></div><div id="respawn" class="respawn hidden"></div><div id="toast" class="toast"></div></section></main>`;

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
  state.socket.on('session:ready', (data) => { state.token = data.token; state.playerId = data.playerId; sessionStorage.setItem('dot-tank-token', data.token); document.querySelector('#lobby')!.classList.add('hidden'); document.querySelector('#game')!.classList.remove('hidden'); });
  state.socket.on('arena:state', (snapshot: ArenaSnapshot) => { createDamageParticles(snapshot); state.snapshot = snapshot; renderHud(); });
  state.socket.on('player:error', (data) => { if (state.token && data.message.includes('expired')) { state.token = ''; sessionStorage.removeItem('dot-tank-token'); state.socket!.emit('queue:join', { name, color: selectedColor }); return; } errorElement.textContent = data.message; });
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
    const respawn = document.querySelector('#respawn')!; respawn.classList.toggle('hidden', me.respawnIn === 0); respawn.textContent = me.respawnIn ? `REBOOTING // ${(me.respawnIn / 1000).toFixed(1)}` : '';
  }
}

function createDamageParticles(snapshot: ArenaSnapshot) {
  for (const player of snapshot.players) { const oldHealth = previousHealth.get(player.id); if (oldHealth !== undefined && oldHealth > player.health) burst(player.x, player.y, colorValues[player.color], player.health === 0 ? 18 : 6); previousHealth.set(player.id, player.health); }
}
function burst(x: number, y: number, color: string, count: number) { for (let index = 0; index < count; index += 1) particles.push({ x, y, vx: (Math.random() - .5) * 12, vy: (Math.random() - .5) * 12, life: 450 + Math.random() * 300, color: index % 3 ? color : '#fff3a6', size: 3 + Math.floor(Math.random() * 4) }); }
function escapeHtml(value: string) { const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }; return value.replace(/[&<>"']/g, (character) => entities[character]); }
function showToast(message: string) { const toast = document.querySelector('#toast')!; toast.textContent = message; toast.classList.add('show'); window.setTimeout(() => toast.classList.remove('show'), 2500); }

const canvas = document.querySelector<HTMLCanvasElement>('#arena')!; const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false;
function resize() { const ratio = window.devicePixelRatio || 1; canvas.width = Math.floor(window.innerWidth * ratio); canvas.height = Math.floor(window.innerHeight * ratio); canvas.style.width = `${window.innerWidth}px`; canvas.style.height = `${window.innerHeight}px`; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.imageSmoothingEnabled = false; } window.addEventListener('resize', resize); resize();

function draw() {
  const width = window.innerWidth; const height = window.innerHeight; context.fillStyle = '#070a12'; context.fillRect(0, 0, width, height);
  if (state.snapshot) {
    const me = state.snapshot.players.find((player) => player.id === state.playerId) ?? state.snapshot.players[0]; const scale = Math.max(.55, Math.min(1, Math.min(width / 1050, height / 720))); const ox = Math.round(width / 2 - (me?.x ?? state.snapshot.width / 2) * scale); const oy = Math.round(height / 2 - (me?.y ?? state.snapshot.height / 2) * scale);
    context.save(); context.translate(ox, oy); context.scale(scale, scale); drawArena(state.snapshot);
    for (const dot of state.snapshot.dots) drawDot(dot.x, dot.y);
    for (const bullet of state.snapshot.bullets) { context.save(); context.translate(Math.round(bullet.x), Math.round(bullet.y)); context.rotate(Math.round(bullet.angle / (Math.PI / 4)) * (Math.PI / 4)); context.fillStyle = '#fff7c2'; context.fillRect(-3, -3, 10, 6); context.fillStyle = colorValues[bullet.color]; context.fillRect(-7, -2, 4, 4); context.restore(); }
    for (const player of state.snapshot.players) drawTank(player);
    updateParticles(); context.restore();
  }
  requestAnimationFrame(draw);
}

function drawArena(snapshot: ArenaSnapshot) {
  context.fillStyle = '#111a24'; context.fillRect(0, 0, snapshot.width, snapshot.height);
  for (let y = 0; y < snapshot.height; y += 32) for (let x = 0; x < snapshot.width; x += 32) { const inside = x >= snapshot.boundary && x < snapshot.width - snapshot.boundary && y >= snapshot.boundary && y < snapshot.height - snapshot.boundary; context.fillStyle = inside ? ((x / 32 + y / 32) % 2 ? '#172331' : '#14202c') : ((x / 32 + y / 32) % 2 ? '#281329' : '#1e1022'); context.fillRect(x, y, 32, 32); if (inside && (x + y) % 128 === 0) { context.fillStyle = '#213344'; context.fillRect(x + 5, y + 7, 4, 4); context.fillRect(x + 22, y + 19, 3, 3); } }
  context.fillStyle = '#ff4fa3'; context.fillRect(snapshot.boundary - 6, snapshot.boundary - 6, snapshot.width - snapshot.boundary * 2 + 12, 6); context.fillRect(snapshot.boundary - 6, snapshot.height - snapshot.boundary, snapshot.width - snapshot.boundary * 2 + 12, 6); context.fillRect(snapshot.boundary - 6, snapshot.boundary, 6, snapshot.height - snapshot.boundary * 2); context.fillRect(snapshot.width - snapshot.boundary, snapshot.boundary, 6, snapshot.height - snapshot.boundary * 2);
  context.fillStyle = '#7a245a'; for (let x = snapshot.boundary; x < snapshot.width - snapshot.boundary; x += 24) { context.fillRect(x, snapshot.boundary - 12, 12, 6); context.fillRect(x + 12, snapshot.height - snapshot.boundary + 6, 12, 6); }
}

function drawDot(x: number, y: number) { context.fillStyle = '#9b6e22'; context.fillRect(Math.round(x) - 7, Math.round(y) - 7, 14, 14); context.fillStyle = '#ffd85c'; context.fillRect(Math.round(x) - 5, Math.round(y) - 5, 10, 10); context.fillStyle = '#fff3a6'; context.fillRect(Math.round(x) - 3, Math.round(y) - 3, 4, 4); }
function drawTank(player: PlayerSnapshot) {
  if (player.respawnIn) return; const color = colorValues[player.color]; const x = Math.round(player.x); const y = Math.round(player.y); const turretAngle = Math.round(player.angle / (Math.PI / 4)) * (Math.PI / 4);
  context.save(); context.translate(x, y); if (player.dashing) { context.fillStyle = '#ffffff'; context.fillRect(-28 - Math.sign(player.vx) * 8, -14, 8, 6); context.fillRect(-30 - Math.sign(player.vx) * 5, 7, 6, 5); }
  context.fillStyle = '#080b12'; context.fillRect(-18, -15, 36, 7); context.fillRect(-18, 8, 36, 7); context.fillStyle = '#596273'; for (let track = -14; track <= 10; track += 8) { context.fillRect(track, -13, 5, 3); context.fillRect(track, 10, 5, 3); }
  context.fillStyle = color; context.fillRect(-15, -9, 30, 18); context.fillStyle = '#101827'; context.fillRect(-9, -6, 18, 12); context.fillStyle = '#e8edf5'; context.fillRect(-4, -3, 8, 6);
  context.rotate(turretAngle); context.fillStyle = color; context.fillRect(-5, -5, 27, 10); context.fillStyle = '#fff'; context.fillRect(18, -3, 8, 6); context.restore();
  if (player.shielded) { context.strokeStyle = '#7ffcff'; context.lineWidth = 3; context.strokeRect(x - 25, y - 24, 50, 48); }
  context.textAlign = 'center'; context.font = 'bold 11px monospace'; context.fillStyle = '#f4f7ff'; context.fillText(`${player.name} L${player.level}`, x, y - 29); context.fillStyle = '#3b1423'; context.fillRect(x - 25, y + 22, 50, 5); context.fillStyle = color; context.fillRect(x - 25, y + 22, Math.max(0, 50 * player.health / player.maxHealth), 5);
}
function updateParticles() { for (let index = particles.length - 1; index >= 0; index -= 1) { const particle = particles[index]; particle.x += particle.vx; particle.y += particle.vy; particle.vx *= .91; particle.vy *= .91; particle.life -= 16; context.fillStyle = particle.color; context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size); if (particle.life <= 0) particles.splice(index, 1); } }
draw();

function setMovement(key: string, pressed: boolean) { if (key === 'w' || key === 'arrowup') state.input.up = pressed; if (key === 's' || key === 'arrowdown') state.input.down = pressed; if (key === 'a' || key === 'arrowleft') state.input.left = pressed; if (key === 'd' || key === 'arrowright') state.input.right = pressed; }
window.addEventListener('keydown', (event) => { setMovement(event.key.toLowerCase(), true); if (event.code === 'Space') { state.input.dash = true; event.preventDefault(); } });
window.addEventListener('keyup', (event) => { setMovement(event.key.toLowerCase(), false); if (event.code === 'Space') state.input.dash = false; });
window.addEventListener('mousemove', (event) => { state.input.angle = Math.atan2(event.clientY - window.innerHeight / 2, event.clientX - window.innerWidth / 2); });
window.addEventListener('mousedown', () => { state.input.firing = true; }); window.addEventListener('mouseup', () => { state.input.firing = false; });
window.addEventListener('blur', () => { state.input.up = false; state.input.down = false; state.input.left = false; state.input.right = false; state.input.firing = false; state.input.dash = false; });

const stick = document.querySelector<HTMLDivElement>('#stick')!; const fire = document.querySelector<HTMLButtonElement>('#fire')!; const dash = document.querySelector<HTMLButtonElement>('#dash')!;
stick.addEventListener('touchmove', (event) => { const touch = event.touches[0]; const rect = stick.getBoundingClientRect(); const dx = touch.clientX - (rect.left + rect.width / 2); const dy = touch.clientY - (rect.top + rect.height / 2); state.input.left = dx < -12; state.input.right = dx > 12; state.input.up = dy < -12; state.input.down = dy > 12; state.input.angle = Math.atan2(dy, dx); event.preventDefault(); }, { passive: false });
stick.addEventListener('touchend', () => { state.input.up = false; state.input.down = false; state.input.left = false; state.input.right = false; });
fire.addEventListener('pointerdown', () => { state.input.firing = true; }); fire.addEventListener('pointerup', () => { state.input.firing = false; });
dash.addEventListener('pointerdown', () => { state.input.dash = true; }); dash.addEventListener('pointerup', () => { state.input.dash = false; });
window.setInterval(() => { if (state.connected) state.socket?.emit('player:input', state.input); }, 50);

if (storedToken && storedName) connect(storedName);
