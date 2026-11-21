# GHADI

Investment/deposit platform (Node + Express) with manual UPI deposits, wallet,
daily payouts and a separate admin panel.

Database: **PostgreSQL**. In production it uses `DATABASE_URL` (Neon/Render).
For local development without Postgres it automatically falls back to an
embedded Postgres (PGlite) stored in `data/ghadi-pg`.

## Run locally

```bash
cd ghadi
pnpm install
node server.js
```

- Public site: http://localhost:3000
- Admin panel: http://localhost:3000/admin (not linked from public site)
- Tables, config defaults, admin and demo plans are created on first start.

## Default admin

- Phone: 9999999999
- Password: admin123

Change the password right after the first login (Admin → Settings).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon, Render, etc.) |
| `PORT` | HTTP port (default 3000) |
| `USER_JWT_SECRET` | Secret for user tokens |
| `ADMIN_JWT_SECRET` | Secret for admin tokens |
| `ADMIN_PHONE` / `ADMIN_PASSWORD` | First-run admin account |
| `PGLITE_PATH` | Local embedded DB folder (default `./data/ghadi-pg`) |

## Deploy on Render (free)

1. Push this repo to GitHub.
2. Create a free Postgres database on Neon (https://neon.tech) and copy the
   connection string (it ends with `?sslmode=require`).
3. On Render: **New → Web Service**, connect the repo, plan **Free**.
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/api/common/config`
4. Add env vars: `DATABASE_URL`, `USER_JWT_SECRET`, `ADMIN_JWT_SECRET`,
   `ADMIN_PHONE`, `ADMIN_PASSWORD`.
5. Deploy. Tables and seed data are created automatically.

`render.yaml` is included for Blueprint deploys.

## Payments

By default `mock_payments=1` so non-manual recharges auto-credit for testing.

**Manual UPI (default):** set `upi_id`, `upi_name` and optionally `upi_qr`
(image URL or data URI) in Admin → Settings. The user pays, submits the UTR,
and the admin approves the recharge to credit the wallet.

**Razorpay:** set `razorpay_key_id`, `razorpay_key_secret` and
`mock_payments=0` in Admin → Settings.

## Notes

- Daily payout cron runs at 00:30 IST. Admin can also trigger it manually.
- Minimum withdrawal: ₹230.
- Admin can add money to any user from Admin → Users.
