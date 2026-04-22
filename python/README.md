# khpay — Python SDK & CLI

Official Python package for the [KHPay](https://khpay.site) payment gateway.

## Install

```bash
pip install khpay
```

## Library usage

```python
from khpay import KHPay

client = KHPay("ak_your_api_key")
payment = client.create_payment(10.00, "USD", "Order #123")
print(payment["data"]["payment_url"])

status = client.check_payment(payment["data"]["transaction_id"])
```

### Verify a webhook signature

```python
from khpay import KHPay

ok = KHPay.verify_webhook_signature(raw_body, header_signature, webhook_secret)
```

## CLI

Once installed, the `khpay` command is available on your `PATH`.

```bash
khpay login                   # paste your ak_… key (stored in ~/.khpay/config.json, mode 0600)
khpay whoami                  # show merchant info
khpay logs --status 400       # filter API logs
khpay inspect 1842            # full body + headers for log #1842
khpay test success            # magic $1 → auto-success
khpay test decline            # magic $2 → declined
khpay test gateway-down       # magic $3 → 502
khpay test fraud              # magic $4 → fraud-block
khpay webhook test            # fire test webhook
khpay config                  # show saved config (key is masked)
```

### Environment variables

- `KHPAY_API_KEY` — overrides stored key
- `KHPAY_BASE_URL` — overrides stored base URL (default `https://khpay.site/api/v1`)

## Requirements

- Python 3.8+
- No runtime dependencies (uses stdlib only)

## License

MIT
