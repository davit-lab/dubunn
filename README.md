# Dubuni

## Local development

```sh
npm ci
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` to override the public project configuration. Use values from the same Supabase project. Browser code must use a publishable (or legacy anon) key, never a secret/service-role key.

## Realtime connection failures

Content, bookings, and notifications use Supabase Realtime when available. If a subscription errors, times out, or closes, its channel is removed and reads continue over HTTPS every 30 seconds while the tab is visible and online. Returning to the tab refreshes data immediately. A network `online` event attempts a new subscription. Initial loads and admin saves use HTTPS independently of WebSockets.

If the deployment's WebSocket connection is consistently blocked, set this build environment variable in Vercel and redeploy:

```dotenv
VITE_SUPABASE_REALTIME_ENABLED=false
```

This prevents WebSocket connections entirely. Data updates then arrive on the next HTTP refresh (up to 30 seconds in an active tab). Remove the variable or set it to `true` and redeploy to restore realtime subscriptions.

The browser's generic `WebSocket connection failed` message alone does not identify the server-side cause. To restore WebSockets, inspect the failed request in DevTools → Network → WS and check the Supabase project status, Realtime logs, and URL/key pair. Also test without a VPN, blocking extension, or restrictive network. Table publication/RLS issues occur after a successful socket handshake; changing these cannot repair a failed handshake.

Supabase references: [Realtime protocol](https://supabase.com/docs/guides/realtime/protocol), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Verification

```sh
node --test tests/*.test.cjs
npx tsc --noEmit
npm run build
```
