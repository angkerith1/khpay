# KHPay CLI

Official command-line tool for KHPay merchants and developers.

## Install

```bash
npm install -g @khpay/cli
```

Requires Node.js 18 or newer.

## Quick start

```bash
khpay login              # paste your ak_… key from dashboard → Settings → API Keys
khpay whoami             # verify auth
khpay test success       # fire a test-mode charge ($1 magic → auto-success)
khpay test decline       # $2 magic → declined
khpay logs --status=400  # only failed requests
khpay webhook test       # trigger a test webhook to your receiver
```

Config lives in `~/.khpay/config.json` (chmod `0600`). You can also use env vars:

```bash
export KHPAY_API_KEY=ak_...
export KHPAY_BASE_URL=https://khpay.site/api/v1
```

## Test-mode magic amounts

When the request includes `X-Test-Mode: 1` (which `khpay test` sets automatically):

| Amount | Outcome |
|-------:|---------|
| 1      | success |
| 2      | decline |
| 3      | gateway-down (502) |
| 4      | fraud-block |

No money moves. Production traffic is untouched.

## Commands

- `khpay login` — save API key
- `khpay whoami` — print merchant info and key prefix
- `khpay logs [--status=N]` — list recent calls (reads from `/api/v1/logs` — ships in v5.1)
- `khpay inspect <log-id>` — dump full request/response JSON
- `khpay test <scenario>` — fire a magic-amount test charge
- `khpay webhook test` — trigger a test webhook
- `khpay config` — show saved config

## License

MIT — © KHPay
