<?php
/**
 * Plugin Name:       KHPay for WooCommerce
 * Plugin URI:        https://khpay.site
 * Description:       Accept KHQR / ABA / Bakong payments in WooCommerce via KHPay. Customers scan a QR with any Cambodian bank app; orders auto-complete on payment.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            KHPay
 * Author URI:        https://khpay.site
 * Text Domain:       khpay-for-woocommerce
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 *
 * WC requires at least: 6.0
 * WC tested up to:      9.0
 */

if (!defined('ABSPATH')) { exit; }

define('KHPAY_WC_VERSION', '1.0.0');
define('KHPAY_WC_PATH',    plugin_dir_path(__FILE__));
define('KHPAY_WC_URL',     plugin_dir_url(__FILE__));

/**
 * Bail early if WooCommerce is not active.
 * We check after plugins_loaded so child-themes and MU-plugins have a chance to load WC.
 */
add_action('plugins_loaded', 'khpay_wc_init', 11);

function khpay_wc_init() {
    if (!class_exists('WC_Payment_Gateway')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p><strong>KHPay for WooCommerce</strong> requires WooCommerce to be installed and active.</p></div>';
        });
        return;
    }

    require_once KHPAY_WC_PATH . 'includes/class-wc-khpay-api.php';
    require_once KHPAY_WC_PATH . 'includes/class-wc-khpay-gateway.php';
    require_once KHPAY_WC_PATH . 'includes/class-wc-khpay-webhook.php';

    // Register the payment method with WooCommerce.
    add_filter('woocommerce_payment_gateways', 'khpay_wc_register_gateway');

    // Add a quick "Settings" link on the Plugins page.
    add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'khpay_wc_plugin_action_links');

    // Instantiate webhook handler (hooks into woocommerce_api_wc_khpay_webhook).
    new WC_KHPay_Webhook();
}

function khpay_wc_register_gateway($methods) {
    $methods[] = 'WC_KHPay_Gateway';
    return $methods;
}

function khpay_wc_plugin_action_links($links) {
    $settings_url = admin_url('admin.php?page=wc-settings&tab=checkout&section=khpay');
    array_unshift($links, '<a href="' . esc_url($settings_url) . '">' . esc_html__('Settings', 'khpay-for-woocommerce') . '</a>');
    return $links;
}

/**
 * Declare compatibility with WooCommerce High-Performance Order Storage (HPOS).
 * Required for WooCommerce 8+ stores that enabled the new orders table.
 */
add_action('before_woocommerce_init', function () {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables', __FILE__, true
        );
    }
});
