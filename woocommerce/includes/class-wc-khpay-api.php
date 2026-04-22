<?php
/**
 * Minimal KHPay REST API client used by the WooCommerce integration.
 *
 * Uses WordPress's wp_remote_* functions (NOT curl) so it works on managed
 * hosts where curl is disabled. All requests are JSON.
 */

if (!defined('ABSPATH')) { exit; }

class WC_KHPay_API {

    private string $api_key;
    private string $base_url;

    public function __construct(string $api_key, string $base_url = 'https://khpay.site/api/v1') {
        $this->api_key  = $api_key;
        $this->base_url = rtrim($base_url, '/');
    }

    /**
     * Create a QR payment.
     *
     * @param array $args  amount, currency, note, success_url, cancel_url, callback_url, metadata
     * @return array|WP_Error  Decoded JSON body on success, WP_Error on failure.
     */
    public function create_payment(array $args) {
        return $this->request('POST', '/qr/generate', $args);
    }

    /**
     * Check payment status for a transaction_id.
     */
    public function check_payment(string $transaction_id) {
        return $this->request('GET', '/qr/check/' . rawurlencode($transaction_id));
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private function request(string $method, string $path, array $body = null) {
        $url = $this->base_url . $path;

        $headers = [
            'Authorization' => 'Bearer ' . $this->api_key,
            'Accept'        => 'application/json',
            'User-Agent'    => 'KHPay-WooCommerce/' . KHPAY_WC_VERSION,
        ];

        $args = [
            'method'  => $method,
            'headers' => $headers,
            'timeout' => 30,
        ];

        if ($body !== null) {
            $headers['Content-Type'] = 'application/json';
            $args['headers']         = $headers;
            $args['body']            = wp_json_encode($body);

            // Idempotency-Key for POSTs prevents duplicate charges on retry.
            // We derive a deterministic key from order_id + amount when provided
            // so a double-submit from the customer does not create two payments.
            if (isset($body['metadata']['wc_order_id'])) {
                $args['headers']['Idempotency-Key'] = 'wc_' . (int) $body['metadata']['wc_order_id']
                    . '_' . substr(md5((string) ($body['amount'] ?? '')), 0, 8);
            }
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        $raw  = wp_remote_retrieve_body($response);
        $data = json_decode($raw, true);

        if (!is_array($data)) {
            return new WP_Error(
                'khpay_bad_response',
                sprintf('KHPay returned a non-JSON response (HTTP %d).', $code),
                ['status' => $code, 'body' => substr((string) $raw, 0, 500)]
            );
        }

        if ($code >= 400) {
            $err_code = $data['error_code'] ?? 'http_' . $code;
            $err_msg  = $data['error']      ?? 'KHPay request failed';
            return new WP_Error($err_code, $err_msg, $data);
        }

        return $data;
    }
}
