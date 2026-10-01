# Dot Tank Arena

Real-time multiplayer tank arena built for a Railway Socket.IO server and a Sites-hosted frontend.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The game server runs on `http://localhost:3001`.

Set `VITE_SERVER_URL` for a deployed client. Set `CLIENT_ORIGIN` on Railway to the Sites URL (comma-separated origins are supported).

Nicknames are validated on both sides using the shared profanity filter in `shared/profanity.ts`.

## URLs

- Local frontend: `http://localhost:5173`
- Local Socket.IO server: `http://localhost:3001`
- Railway health check after deployment: `https://YOUR-RAILWAY-DOMAIN/health`
- Sites URL after publishing: supplied by Sites after deployment

Set Railway's `CLIENT_ORIGIN` to the exact Sites URL, then set the Sites build variable `VITE_SERVER_URL` to the Railway domain without `/health`.
