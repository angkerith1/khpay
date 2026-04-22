# KHPay — Official SDKs & CLI

Official client libraries and command-line tool for the [KHPay](https://khpay.site) payment gateway (Cambodia · ABA PayWay · KHQR).

> **API docs:** https://khpay.site/api-documentation.php
> **Get an API key:** https://khpay.site/register

## Contents

| Folder | Purpose | Install |
|---|---|---|
| [`cli/`](./cli) | Node.js CLI (`khpay login`, `khpay logs`, `khpay test`, …) | `npm install -g khpay` |
| [`python/`](./python) | Python SDK + CLI (same commands as Node) | `pip install khpay` |
| [`php/`](./php) | PHP SDK (server-side) | copy `KHPay.php` into your project |
| [`js/`](./js) | Browser JS SDK + embeddable widget | `<script src="khpay.js"></script>` |
| [`woocommerce/`](./woocommerce) | WooCommerce payment gateway plugin | upload zip via WP admin |

## Quick start — Node CLI

```bash
npm install -g khpay
khpay login             # paste your ak_… key
khpay whoami
khpay test success      # fires a safe test transaction (no real money)
khpay logs --status 400
khpay inspect 1842
```

## Quick start — Python CLI + SDK

```bash
pip install khpay
khpay login
khpay whoami
```

```python
from khpay import KHPay
client = KHPay("ak_your_api_key")
payment = client.create_payment(10.00, "USD", "Order #123")
print(payment["data"]["payment_url"])
```

## Quick start — PHP

```php
require_once 'php/KHPay.php';
$khpay = new KHPay('ak_your_api_key');
$payment = $khpay->createPayment(10.00, 'USD', 'Order #123');
```

## Webhook signature verification

All SDKs expose the same helper:

```php
KHPay::verifyWebhookSignature($rawBody, $signatureHeader, $webhookSecret);
```

```python
KHPay.verify_webhook_signature(raw_body, signature, secret)
```

## Test mode (no real money)

Send `X-Test-Mode: 1` with any request and use these magic amounts:

| Amount  | Result |
|---------|--------|
| `1.00`  | Auto-success |
| `2.00`  | Declined |
| `3.00`  | Gateway down (502) |
| `4.00`  | Fraud-blocked |

The CLI's `khpay test <scenario>` command sets this automatically.

## License

MIT — see [LICENSE](./LICENSE).

## Support

- Docs: https://khpay.site/api-documentation.php
- Status: https://khpay.site/status
- Issues: please open a GitHub issue on this repo
# KHPAY SDK Libraries

Official client libraries for the KHPAY Payment Gateway API.

## Available SDKs

| Language | Path | Min Version |
|----------|------|-------------|
| PHP | `sdk/php/KHPay.php` | PHP 8.0+ (curl) |
| JavaScript | `sdk/js/khpay.js` | Node 18+ or any modern browser |
| Python | `sdk/python/khpay.py` | Python 3.8+ (stdlib only) |

## Quick Start

### PHP
```php
require_once 'sdk/php/KHPay.php';

$khpay = new KHPay('your_api_key');

// Create a payment
$payment = $khpay->createPayment(10.00, 'USD', 'Order #123');
echo $payment['data']['qr_url'];

// Check status
$status = $khpay->checkPayment('txn_abc123');

// Verify webhook signature
$isValid = KHPay::verifyWebhookSignature($rawBody, $signature, $webhookSecret);
```

### JavaScript
```javascript
const KHPay = require('./sdk/js/khpay');

const client = new KHPay('your_api_key');

// Create a payment
const payment = await client.createPayment(10.00, 'USD', 'Order #123');
console.log(payment.data.qr_url);

// Check status
const status = await client.checkPayment('txn_abc123');

// Verify webhook
const valid = await KHPay.verifyWebhookSignature(body, sig, secret);
```

### Python
```python
from sdk.python.khpay import KHPay

client = KHPay('your_api_key')

# Create a payment
payment = client.create_payment(10.00, 'USD', 'Order #123')
print(payment['data']['qr_url'])

# Check status
status = client.check_payment('txn_abc123')

# Verify webhook
valid = KHPay.verify_webhook_signature(body, sig, secret)
```

## Features

All SDKs support:
- QR payment generation (single & batch)
- Payment status checking
- Transaction listing & filtering
- Webhook CRUD & signature verification
- Scheduled/recurring payments
- API key rotation
- Account info & stats

## Authentication

All API requests require a Bearer token. Get your API key from the KHPAY dashboard under Settings.

```
Authorization: Bearer your_api_key_here
```

## Error Handling

Each SDK throws typed exceptions on API errors with HTTP status code and error message from the server.
