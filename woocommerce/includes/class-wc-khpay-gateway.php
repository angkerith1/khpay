<?php
/**
 * KHPay Payment Gateway for WooCommerce.
 *
 * Flow:
 *   1. Customer submits checkout -> process_payment() calls KHPay to create a QR.
 *   2. We redirect the customer to the hosted KHPay payment page (result['payment_url']).
 *   3. After payment, KHPay:
 *        a) Fires a server-to-server webhook to our callback_url (primary trust path).
 *        b) Redirects the customer back to success_url (UX path; we verify status).
 *   4. Webhook handler (class-wc-khpay-webhook.php) marks the order complete.
 */

if (!defined('ABSPATH')) { exit; }

class WC_KHPay_Gateway extends WC_Payment_Gateway {

    public function __construct() {
        $this->id                 = 'khpay';
        $this->icon               = apply_filters('khpay_wc_icon', KHPAY_WC_URL . 'assets/khpay-logo.png');
        $this->has_fields         = false;
        $this->method_title       = __('KHPay (KHQR / ABA / Bakong)', 'khpay-for-woocommerce');
        $this->method_description = __('Accept QR payments from any Cambodian bank app via KHPay. Customers are redirected to a hosted QR page.', 'khpay-for-woocommerce');
        $this->supports           = ['products'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title       = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->enabled     = $this->get_option('enabled');
        $this->testmode    = 'yes' === $this->get_option('testmode');
        $this->api_key     = trim((string) $this->get_option('api_key'));
        $this->webhook_secret = trim((string) $this->get_option('webhook_secret'));
        $this->api_base    = rtrim((string) $this->get_option('api_base', 'https://khpay.site/api/v1'), '/');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
    }

    public function init_form_fields() {
        $webhook_url = add_query_arg('wc-api', 'wc_khpay_webhook', home_url('/'));

        $this->form_fields = [
            'enabled' => [
                'title'       => __('Enable/Disable', 'khpay-for-woocommerce'),
                'type'        => 'checkbox',
                'label'       => __('Enable KHPay', 'khpay-for-woocommerce'),
                'default'     => 'no',
            ],
            'title' => [
                'title'       => __('Title', 'khpay-for-woocommerce'),
                'type'        => 'text',
                'description' => __('The name shown to customers at checkout.', 'khpay-for-woocommerce'),
                'default'     => __('KHQR / ABA / Bakong', 'khpay-for-woocommerce'),
                'desc_tip'    => true,
            ],
            'description' => [
                'title'       => __('Description', 'khpay-for-woocommerce'),
                'type'        => 'textarea',
                'description' => __('Shown to customers under the payment method on the checkout page.', 'khpay-for-woocommerce'),
                'default'     => __('Pay with any Cambodian bank app — scan the QR code on the next page.', 'khpay-for-woocommerce'),
            ],
            'api_key' => [
                'title'       => __('API Key', 'khpay-for-woocommerce'),
                'type'        => 'password',
                'description' => __('Find this in your KHPay Dashboard → API Keys. Starts with <code>ak_</code>.', 'khpay-for-woocommerce'),
                'default'     => '',
                'placeholder' => 'ak_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            ],
            'webhook_secret' => [
                'title'       => __('Webhook Secret', 'khpay-for-woocommerce'),
                'type'        => 'password',
                'description' => sprintf(
                    /* translators: %s: webhook URL */
                    __('In your KHPay Dashboard, create a webhook pointing to <br><code>%s</code><br>and paste the returned secret here. Required to auto-complete orders.', 'khpay-for-woocommerce'),
                    esc_html($webhook_url)
                ),
                'default'     => '',
            ],
            'testmode' => [
                'title'       => __('Test Mode', 'khpay-for-woocommerce'),
                'type'        => 'checkbox',
                'label'       => __('Enable test mode (uses <code>X-Test-Mode: true</code>)', 'khpay-for-woocommerce'),
                'default'     => 'no',
                'description' => __('Use magic amounts 1.00 (success), 2.00 (decline), 3.00 (gateway down), 4.00 (fraud block) to test.', 'khpay-for-woocommerce'),
            ],
            'api_base' => [
                'title'       => __('API Base URL', 'khpay-for-woocommerce'),
                'type'        => 'text',
                'default'     => 'https://khpay.site/api/v1',
                'description' => __('Leave as default unless KHPay support instructs otherwise.', 'khpay-for-woocommerce'),
            ],
        ];
    }

    /**
     * Show a banner at checkout if KHPay is not fully configured.
     */
    public function admin_options() {
        parent::admin_options();

        if ('yes' === $this->enabled && $this->api_key === '') {
            echo '<div class="notice notice-warning"><p>'
                . esc_html__('KHPay is enabled but no API key is set. Customers will see errors at checkout.', 'khpay-for-woocommerce')
                . '</p></div>';
        }
        if ('yes' === $this->enabled && $this->webhook_secret === '') {
            echo '<div class="notice notice-warning"><p>'
                . esc_html__('Webhook secret is blank. Orders will not auto-complete when customers pay. Set up the webhook in your KHPay dashboard.', 'khpay-for-woocommerce')
                . '</p></div>';
        }
    }

    /**
     * Called by WC when customer clicks "Place order".
     * Returns the redirect target (hosted KHPay QR page).
     */
    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            wc_add_notice(__('Order not found.', 'khpay-for-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        if ($this->api_key === '') {
            wc_add_notice(__('KHPay is not configured. Please contact the merchant.', 'khpay-for-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        // Currency guard — KHPay supports USD and KHR.
        $currency = strtoupper($order->get_currency());
        if (!in_array($currency, ['USD', 'KHR'], true)) {
            wc_add_notice(sprintf(
                /* translators: %s: currency code */
                __('KHPay does not support %s. Please use USD or KHR.', 'khpay-for-woocommerce'),
                esc_html($currency)
            ), 'error');
            return ['result' => 'failure'];
        }

        $api = new WC_KHPay_API($this->api_key, $this->api_base);

        $webhook_url = add_query_arg('wc-api', 'wc_khpay_webhook', home_url('/'));

        $payload = [
            'amount'       => number_format((float) $order->get_total(), 2, '.', ''),
            'currency'     => $currency,
            'note'         => sprintf(__('Order #%s', 'khpay-for-woocommerce'), $order->get_order_number()),
            'success_url'  => esc_url_raw($this->get_return_url($order)),
            'cancel_url'   => esc_url_raw($order->get_cancel_order_url_raw()),
            'callback_url' => esc_url_raw($webhook_url),
            'metadata'     => [
                'wc_order_id'    => (string) $order->get_id(),
                'wc_order_key'   => (string) $order->get_order_key(),
                'customer_email' => (string) $order->get_billing_email(),
            ],
        ];

        // Send test-mode header if enabled.
        if ($this->testmode) {
            add_filter('http_request_args', [$this, 'inject_test_mode_header'], 10, 2);
        }

        $response = $api->create_payment($payload);

        if ($this->testmode) {
            remove_filter('http_request_args', [$this, 'inject_test_mode_header'], 10);
        }

        if (is_wp_error($response)) {
            $msg = $response->get_error_message();
            $order->add_order_note(sprintf('KHPay payment creation failed: %s', $msg));
            wc_add_notice(__('Payment gateway error: ', 'khpay-for-woocommerce') . esc_html($msg), 'error');
            return ['result' => 'failure'];
        }

        if (empty($response['success']) || empty($response['data']['transaction_id']) || empty($response['data']['payment_url'])) {
            $order->add_order_note('KHPay returned an unexpected response: ' . wp_json_encode($response));
            wc_add_notice(__('Payment gateway returned an invalid response. Please try again.', 'khpay-for-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        $txn_id      = $response['data']['transaction_id'];
        $payment_url = $response['data']['payment_url'];

        // Store KHPay transaction ID on the order (HPOS-safe: update_meta_data + save).
        $order->update_meta_data('_khpay_transaction_id', $txn_id);
        $order->update_status('pending', sprintf(
            /* translators: %s: KHPay transaction ID */
            __('Awaiting KHPay payment. Transaction ID: %s', 'khpay-for-woocommerce'),
            $txn_id
        ));
        $order->save();

        // Let WooCommerce render the receipt page? No — we redirect straight to hosted QR.
        return [
            'result'   => 'success',
            'redirect' => $payment_url,
        ];
    }

    /**
     * Injects X-Test-Mode: true into the KHPay API call. Only active during test mode.
     * Filter scoped by URL match so it never leaks to other HTTP requests.
     */
    public function inject_test_mode_header($args, $url) {
        if (strpos($url, $this->api_base) === 0) {
            $args['headers']                   = is_array($args['headers'] ?? null) ? $args['headers'] : [];
            $args['headers']['X-Test-Mode']    = 'true';
        }
        return $args;
    }
}
