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

## Deploy on Render (image-backed)

Production deploys do not build on Render. GitHub Actions builds the Docker
image, pushes it to GitHub Container Registry, and then triggers the Render
deploy:

1. Push to `master`.
2. `.github/workflows/docker.yml` builds `ghcr.io/<owner>/ghadi:latest` and
   pushes it using the repo's `GITHUB_TOKEN`.
3. The same workflow calls the Render API to deploy the new image.
4. Render pulls the image with the `ghadi-ghcr` registry credential and
   restarts the service at https://ghadi.onrender.com.

Required GitHub repository secret: `RENDER_API_KEY` (Render workspace API key).

The Render service is image-backed (`runtime: image`, image
`ghcr.io/<owner>/ghadi:latest`). Environment variables (`DATABASE_URL`, JWT
secrets, admin login) stay in Render. `render.yaml` is the original blueprint
and is not used for image deploys.

Local Docker run:

```bash
docker build -t ghadi .
docker run --rm -p 3000:3000 --env-file .env ghadi
```

> Render's free Postgres is deleted after 30 days. For long-term use, create a
> free Postgres on Neon (https://neon.tech) and replace `DATABASE_URL` with its
> connection string (ending in `?sslmode=require`). Dump/restore data first.
> A Render Starter database or disk-backed plan also works.

## Payments

By default `mock_payments=0`, so online channels are disabled until Razorpay or
RupayEx is configured. For local testing only, set `mock_payments=1` in
Admin → Settings to auto-credit recharges.

**Manual UPI (default):** set `upi_id`, `upi_name` and optionally `upi_qr`
(image URL or data URI) in Admin → Settings. The user pays, submits the UTR,
and the admin approves the recharge to credit the wallet.

**Razorpay:** set `razorpay_key_id`, `razorpay_key_secret` and
`mock_payments=0` in Admin → Settings.

**RupayEx (UPI / Card checkout):** get your API token from the RupayEx merchant
panel, then in Admin → Settings set:

| Key | Value |
| --- | --- |
| `rupayex_token` | your RupayEx API token |
| `rupayex_enabled` | `1` |
| `rupayex_base` | `https://rupayex.net` |

Users then see **UPI / Card (RupayEx)** in Wallet → Recharge. They are
redirected to the hosted checkout; the site verifies the payment with
`/api/order-status` and credits the wallet once. The webhook is
`/api/wallet/rupayex/webhook`. API reference: https://rupayex.net/documentation

## Withdrawals (manual payout)

Withdrawals are paid manually. The user saves a bank account and/or UPI ID in
**Payout Details**, then requests a withdrawal with their withdraw password.
The amount (including fee) is deducted from the wallet immediately and a
`pending` withdrawal is created with a snapshot of the payout details.

To pay:

1. Open **Admin → Withdrawals** (pending requests are shown by default).
2. Copy the bank/UPI details and transfer the **Net** amount from your own
   bank or UPI app.
3. Enter the bank **UTR / reference** in the row and click **Approve**.
   The user is marked `paid` and their transaction becomes `success`.
4. **Reject** refunds the full amount to the user's wallet.

Approve stays disabled until a valid UTR (8–18 letters/digits) is entered, so a
withdrawal cannot be marked paid without a transfer reference.

## Notes

- Daily payout cron runs at 00:30 IST. Admin can also trigger it manually.
- Minimum withdrawal: ₹230.
- Admin can add money to any user from Admin → Users.
- Withdrawal payouts are manual (bank/UPI); see above.
