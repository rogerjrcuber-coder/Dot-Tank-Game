export type ArenaId = 0 | 1 | 2 | 3 | 4;
export type PlayerColor = 'pink' | 'cyan' | 'lime' | 'orange' | 'violet' | 'yellow';
export type BotPersonality = 'hunter' | 'collector' | 'berserker' | 'sniper' | 'opportunist' | 'survivor';
export type EnvironmentKind = 'brick' | 'rock' | 'branch' | 'bush' | 'flower' | 'dirt' | 'gravel';
export type PowerUpKind = 'reinforced' | 'batteries' | 'treads' | 'bumper' | 'shocks';

export interface PlayerSnapshot {
  id: string; name: string; color: PlayerColor; arenaId: ArenaId; x: number; y: number; angle: number;
  vx: number; vy: number; health: number; maxHealth: number; level: number; xp: number;
  eliminations: number; deaths: number; shielded: boolean; isBot: boolean; connected: boolean;
  dashing: boolean; dashCooldown: number; respawnIn: number; staggeredIn: number; concealed: boolean;
  dotsCollected: number; powerUp?: PowerUpKind; powerUpIn: number; personality?: BotPersonality;
}

export interface DotSnapshot { id: string; x: number; y: number; value: number; }
export interface BulletSnapshot { id: string; x: number; y: number; angle: number; color: PlayerColor; }
export interface EnvironmentSnapshot { id: string; kind: EnvironmentKind; x: number; y: number; width: number; height: number; solid: boolean; }
export interface ObjectiveSnapshot { id: string; x: number; y: number; health: number; maxHealth: number; activeUntil: number; }
export interface PowerUpSnapshot { id: string; x: number; y: number; kind: PowerUpKind; expiresAt: number; }
export interface KillFeedItem { id: string; attacker: string; victim: string; cause: 'shot' | 'bump' | 'ringout'; createdAt: number; }
export interface ArenaSnapshot {
  arenaId: ArenaId; width: number; height: number; boundary: number; players: PlayerSnapshot[];
  dots: DotSnapshot[]; bullets: BulletSnapshot[]; environment: EnvironmentSnapshot[];
  objective?: ObjectiveSnapshot; nextObjectiveIn: number; powerUps: PowerUpSnapshot[];
  killFeed: KillFeedItem[]; online: number; bots: number; serverTime: number;
}

export interface PlayerInput {
  up: boolean; down: boolean; left: boolean; right: boolean; firing: boolean; dash: boolean; angle: number;
}

export interface ClientToServerEvents {
  'queue:join': (payload: { name: string; color: PlayerColor }) => void;
  'queue:leave': () => void;
  'player:input': (payload: PlayerInput) => void;
  'player:reconnect': (payload: { token: string }) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: { token: string; arenaId: ArenaId; playerId: string }) => void;
  'arena:state': (payload: ArenaSnapshot) => void;
  'player:error': (payload: { message: string }) => void;
}
