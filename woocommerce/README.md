# KHPay for WooCommerce

Accept KHQR / ABA / Bakong payments on any WooCommerce store.

## Install

1. Zip the `khpay-for-woocommerce/` directory:
   ```
   sdk/woocommerce/khpay-for-woocommerce.php
   sdk/woocommerce/includes/class-wc-khpay-api.php
   sdk/woocommerce/includes/class-wc-khpay-gateway.php
   sdk/woocommerce/includes/class-wc-khpay-webhook.php
   sdk/woocommerce/README.md
   ```
   Place those files under a folder named `khpay-for-woocommerce/` and zip it.
2. In WordPress admin: **Plugins → Add New → Upload Plugin** → choose the zip → Install → Activate.
3. Go to **WooCommerce → Settings → Payments → KHPay → Manage**.

## Configure

| Field            | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| Enable KHPay     | ☑                                                                     |
| API Key          | Copy from **KHPay Dashboard → API Keys** (starts with `ak_`).         |
| Webhook Secret   | See below.                                                             |
| Test Mode        | Turn on while developing.                                              |

### Webhook setup (required for auto-completion)

1. The plugin shows your webhook URL on the settings page, e.g.:
   ```
   https://yourshop.example.com/?wc-api=wc_khpay_webhook
   ```
2. In **KHPay Dashboard → Webhooks**, click **Add Webhook** and paste that URL.
3. Tick the events `payment.paid`, `payment.expired`, `payment.failed`.
4. Copy the generated **secret** and paste it into the plugin's **Webhook Secret** field.
5. Save.

## How it works

1. Customer clicks **Place order**.
2. Plugin calls `POST https://khpay.site/api/v1/qr/generate` with the order total + a callback URL.
3. Customer is redirected to KHPay's hosted QR page and pays with their Cambodian bank app.
4. KHPay fires a signed webhook to your WooCommerce store → order is auto-marked **Completed**.
5. Customer is sent back to the WooCommerce thank-you page.

## Test mode

Enable **Test Mode** and place an order with a total of:

| Amount | Result                         |
|--------|--------------------------------|
| 1.00   | Simulated success              |
| 2.00   | Simulated card decline         |
| 3.00   | Simulated gateway down         |
| 4.00   | Simulated fraud block          |

Any other amount in test mode still goes through normal validation but will not charge a real account.

## Troubleshooting

- **Orders stay "Pending" after payment**: the webhook secret is probably wrong. Re-copy it from KHPay Dashboard → Webhooks and save.
- **"Payment gateway error" at checkout**: your API key is invalid or expired. Rotate it in KHPay Dashboard → API Keys.
- **"KHPay does not support <currency>"**: the plugin accepts USD and KHR only. Change your store currency under WooCommerce → Settings → General.

## Requirements

- WordPress 5.8+
- WooCommerce 6.0+
- PHP 7.4+
- Compatible with WooCommerce High-Performance Order Storage (HPOS).

## Support

https://khpay.site/dashboard/notifications.php
