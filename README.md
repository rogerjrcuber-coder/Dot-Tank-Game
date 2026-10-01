# Dot Tank Arena

Real-time multiplayer tank arena built for a Railway Socket.IO server and a Sites-hosted frontend.

Version 1.0.0 features a large backyard battlefield, physical toy cover, concealment bushes, terrain patches, a pixel minimap, stagger-producing dash impacts, dot healing, humanized bots, dual mobile sticks, and five-minute sandcastle events with temporary power-ups. Eliminated tanks respawn at level 1 with zero XP.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The game server runs on `http://localhost:3001`.

Set `VITE_SERVER_URL` for a deployed client. Set `PUBLIC_ORIGIN` on Railway to a comma-separated list of allowed origins, for example `https://dot-tank-arena.r-m2016.chatgpt.site,https://dot-tank-game-production.up.railway.app`.

Nicknames are validated on both sides using the shared profanity filter in `shared/profanity.ts`.

## URLs

- Local frontend: `http://localhost:5173`
- Local Socket.IO server: `http://localhost:3001`
- Railway health check after deployment: `https://YOUR-RAILWAY-DOMAIN/health`
- Sites URL: `https://dot-tank-arena.r-m2016.chatgpt.site`

Set Railway's `PUBLIC_ORIGIN` to the allowed comma-separated origins, then set the Sites build variable `VITE_SERVER_URL` to the tank service's Railway domain without `/health`.
