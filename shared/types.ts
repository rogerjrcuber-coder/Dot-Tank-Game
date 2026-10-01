export type ArenaId = 0 | 1 | 2 | 3 | 4;
export type PlayerColor = 'pink' | 'cyan' | 'lime' | 'orange' | 'violet' | 'yellow';

export interface PlayerSnapshot {
  id: string; name: string; color: PlayerColor; x: number; y: number; angle: number;
  health: number; maxHealth: number; level: number; xp: number; eliminations: number; deaths: number;
  shielded: boolean; isBot: boolean;
}

export interface DotSnapshot { id: string; x: number; y: number; value: number; }
export interface ArenaSnapshot { arenaId: ArenaId; players: PlayerSnapshot[]; dots: DotSnapshot[]; online: number; bots: number; }

export interface ClientToServerEvents {
  'queue:join': (payload: { name: string; color: PlayerColor }) => void;
  'queue:leave': () => void;
  'player:input': (payload: { up: boolean; down: boolean; left: boolean; right: boolean; firing: boolean; angle: number }) => void;
  'player:reconnect': (payload: { token: string }) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: { token: string; arenaId: ArenaId; playerId: string }) => void;
  'arena:state': (payload: ArenaSnapshot) => void;
  'player:error': (payload: { message: string }) => void;
}
