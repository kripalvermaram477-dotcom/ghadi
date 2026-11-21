# GHADI

Investment platform (Node/Express + SQLite) with Razorpay recharge and admin panel.

## Run

```bash
cd ghadi
pnpm install
node scripts/seed.js
node server.js
```

- Public site: http://localhost:3000
- Admin panel: http://localhost:3000/admin (not linked from public site)

## Default admin

- Phone: 9999999999
- Password: admin123

## Payment (Razorpay)

By default `mock_payments=1` so recharges auto-credit for testing.
Set real keys from Admin → Settings:
- razorpay_key_id
- razorpay_key_secret
- mock_payments = 0

## Notes

- Daily payout cron runs at 00:30 IST. Admin can trigger manually via Dashboard.
- SQLite DB stored at data/ghadi.db.