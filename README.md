# adaptiveedge-server

Real-time backend for the AdaptiveEdge trading system.  Receives trade data from MT4, stores account state, and pushes Telegram notifications.

---

## MT4 Bridge EA — `AdaptiveEdgeBridge.mq4`

Located in `MT4/AdaptiveEdgeBridge.mq4`.  
Attach this Expert Advisor to any chart (EURUSD H1 recommended) on the MT4 account to bridge ICT-BOT-V3 trades to the Railway backend.

### What it does

| Feature | Detail |
|---|---|
| **Trade open detection** | Scans every tick for new market orders whose `OrderComment` contains `ICT-BOT-V3` and POSTs to `/mt4/trade/open` |
| **Trade close detection** | Detects when a tracked ticket disappears from open orders and POSTs to `/mt4/trade/close` with close price and net P&L |
| **Heartbeat** | POSTs account stats (balance, equity, daily P&L, drawdown, win-rate, …) to `/mt4/heartbeat` every 30 s (configurable) |
| **Settings sync** | Applies `riskPercent`, `maxDailyLoss`, `maxDrawdown`, `maxTrades`, `trendMode`, `scalpMode`, and `botActive` from the heartbeat response |
| **Risk alerts** | Sends `/mt4/alert` when daily-loss or drawdown limits are breached |
| **Auth** | Every request carries `x-api-key: <MT4_API_KEY>` |

### Setup

1. Copy `MT4/AdaptiveEdgeBridge.mq4` into your MT4 `MQL4/Experts/` folder.
2. Open **Tools → Options → Expert Advisors** in MT4:
   - Tick **Allow WebRequest for listed URL**.
   - Add `https://adaptiveedge-server-production.up.railway.app`.
3. Compile the EA in MetaEditor (F7).
4. Drag the EA onto any chart and fill in the inputs:

| Input | Value |
|---|---|
| `UserId` | Your AdaptiveEdge user ID (from the web app) |
| `ApiKey` | `MT4_API_KEY` from Railway environment variables |
| `ServerUrl` | `https://adaptiveedge-server-production.up.railway.app` |
| `BotComment` | `ICT-BOT-V3` (must match the comment ICT-BOT-V3 writes on orders) |
| `HeartbeatSecs` | `30` |
| `VerboseLog` | `true` during testing, `false` in production |

5. Check the **Experts** tab in the MT4 terminal for `[AdaptiveEdgeBridge] v1.10 started` confirmation.

### API endpoints used

| Method | Path | Trigger |
|---|---|---|
| `POST` | `/mt4/heartbeat` | Every `HeartbeatSecs` seconds |
| `POST` | `/mt4/trade/open` | New ICT-BOT-V3 market order detected |
| `POST` | `/mt4/trade/close` | Tracked order no longer in open positions |
| `POST` | `/mt4/alert` | Daily-loss or drawdown limit breached |

---

## Backend API

Deployed on Railway at `https://adaptiveedge-server-production.up.railway.app`.

### MT4 endpoints (require `x-api-key` header)

- `POST /mt4/heartbeat` — upsert account stats, returns settings + botActive
- `POST /mt4/trade/open` — record a new trade
- `POST /mt4/trade/close` — mark a trade closed
- `POST /mt4/alert` — send a Telegram alert to the user

### User endpoints (require `Authorization: Bearer <jwt>` header)

- `POST /auth/register` — create account
- `POST /auth/login` — get JWT
- `GET /accounts` — list accounts
- `GET /accounts/:id` — single account
- `PATCH /accounts/:id/settings` — update risk settings
- `PATCH /accounts/:id/override` — pause / resume bot
- `GET /trades` — trade history
