<?php
/**
 * KHPay webhook handler.
 *
 * KHPay posts JSON to  https://shop.example.com/?wc-api=wc_khpay_webhook
 * with the header      X-Webhook-Signature: sha256=<hex HMAC of raw body using merchant secret>
 *
 * Events handled:
 *   - payment.paid      -> mark order completed (or processing if has_virtual_download)
 *   - payment.expired   -> mark order cancelled
 *   - payment.failed    -> mark order failed
 *   - payment.refunded  -> mark order refunded (future)
 *   - webhook.test      -> respond 200 OK (for dashboard "Send test" button)
 */

if (!defined('ABSPATH')) { exit; }

class WC_KHPay_Webhook {

    public function __construct() {
        // WooCommerce dispatches /?wc-api=wc_khpay_webhook to this hook.
        add_action('woocommerce_api_wc_khpay_webhook', [$this, 'handle']);
    }

    public function handle() {
        $raw_body = file_get_contents('php://input');

        // Load gateway settings to access webhook secret.
        $settings = get_option('woocommerce_khpay_settings', []);
        $secret   = isset($settings['webhook_secret']) ? trim((string) $settings['webhook_secret']) : '';

        if ($secret === '') {
            $this->respond(500, ['error' => 'Webhook secret not configured in store.']);
            return;
        }

        // Verify HMAC signature (constant-time compare).
        $provided = isset($_SERVER['HTTP_X_WEBHOOK_SIGNATURE']) ? (string) $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] : '';
        if (stripos($provided, 'sha256=') === 0) {
            $provided = substr($provided, 7);
        }
        $expected = hash_hmac('sha256', $raw_body, $secret);
        if (!hash_equals($expected, $provided)) {
            $this->respond(401, ['error' => 'Invalid signature']);
            return;
        }

        $payload = json_decode($raw_body, true);
        if (!is_array($payload)) {
            $this->respond(400, ['error' => 'Invalid JSON']);
            return;
        }

        $event = $payload['event'] ?? '';
        $data  = $payload['data']  ?? [];

        // Test deliveries just need a 200 back.
        if ($event === 'webhook.test') {
            $this->respond(200, ['ok' => true, 'message' => 'Test received']);
            return;
        }

        $txn_id = $data['transaction_id'] ?? '';
        if ($txn_id === '') {
            $this->respond(400, ['error' => 'Missing transaction_id']);
            return;
        }

        // Locate the WooCommerce order that owns this transaction.
        $order = $this->find_order_by_transaction_id($txn_id);
        if (!$order) {
            // KHPay will stop retrying on 2xx. We 200 on "unknown txn" because
            // the merchant may have deleted the order; retrying won't help.
            $this->respond(200, ['ignored' => true, 'reason' => 'No WooCommerce order found for transaction']);
            return;
        }

        // Idempotency: do not transition a completed order twice.
        switch ($event) {
            case 'payment.paid':
                if ($order->is_paid()) {
                    $this->respond(200, ['ok' => true, 'already' => 'paid']);
                    return;
                }
                // Amount safety check (defense in depth — KHPay already validated).
                $expected = (float) $order->get_total();
                $received = isset($data['amount']) ? (float) $data['amount'] : 0.0;
                if (abs($expected - $received) > 0.01) {
                    $order->add_order_note(sprintf(
                        'KHPay webhook amount mismatch: expected %s, got %s. NOT marking as paid.',
                        $expected, $received
                    ));
                    $this->respond(400, ['error' => 'Amount mismatch']);
                    return;
                }
                $order->payment_complete($txn_id);
                $order->add_order_note(sprintf('KHPay payment received. Transaction: %s', $txn_id));
                break;

            case 'payment.expired':
                if (!$order->has_status(['cancelled', 'completed', 'processing', 'refunded'])) {
                    $order->update_status('cancelled', 'KHPay payment expired without being paid.');
                }
                break;

            case 'payment.failed':
                if (!$order->has_status(['failed', 'cancelled', 'completed', 'processing', 'refunded'])) {
                    $order->update_status('failed', 'KHPay payment failed.');
                }
                break;

            case 'payment.refunded':
                if (!$order->has_status('refunded')) {
                    $order->update_status('refunded', 'KHPay marked this payment as refunded.');
                }
                break;

            default:
                $this->respond(200, ['ignored' => true, 'event' => $event]);
                return;
        }

        $this->respond(200, ['ok' => true, 'order_id' => $order->get_id()]);
    }

    /**
     * Find the WC order that stored this KHPay transaction_id in postmeta.
     * Uses wc_get_orders() so it is HPOS-compatible.
     */
    private function find_order_by_transaction_id(string $txn_id) {
        $orders = wc_get_orders([
            'limit'      => 1,
            'meta_key'   => '_khpay_transaction_id',
            'meta_value' => $txn_id,
            'return'     => 'objects',
        ]);
        return !empty($orders) ? $orders[0] : null;
    }

    private function respond(int $code, array $body): void {
        status_header($code);
        nocache_headers();
        header('Content-Type: application/json; charset=utf-8');
        echo wp_json_encode($body);
        exit;
    }
}
