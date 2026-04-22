/**
 * KHPAY Embeddable Payment Widget (Drop-in JS)
 * Usage:
 *   <script src="https://yourdomain.com/sdk/js/widget.js"></script>
 *   <div id="khpay-button" data-key="pk_live_xxxxx" data-amount="10.00" data-currency="USD" data-note="Order #123"></div>
 *
 * Or programmatic:
 *   KHPay.init({ publicKey: 'pk_live_xxxxx' });
 *   KHPay.createPayment({ amount: 10, currency: 'USD', note: 'Order #123' }).then(result => {});
 */
(function(window, document) {
    'use strict';

    var KHPAY_API_BASE = '';
    var KHPAY_SITE_URL = '';

    // Auto-detect base URL from script src
    (function() {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('widget.js') !== -1 || src.indexOf('khpay') !== -1) {
                var url = new URL(src);
                KHPAY_SITE_URL = url.origin;
                KHPAY_API_BASE = url.origin + '/api/v1';
                break;
            }
        }
    })();

    var KHPay = {
        _config: {
            publicKey: '',
            theme: 'dark',
            locale: 'en',
            onSuccess: null,
            onError: null,
            onClose: null,
        },

        init: function(config) {
            if (!config.publicKey) {
                console.error('[KHPay] publicKey is required');
                return;
            }
            Object.assign(this._config, config);
            if (config.apiBase) KHPAY_API_BASE = config.apiBase;
            if (config.siteUrl) KHPAY_SITE_URL = config.siteUrl;
            this._mountButtons();
        },

        createPayment: function(options) {
            var self = this;
            return new Promise(function(resolve, reject) {
                var amount = parseFloat(options.amount);
                if (!amount || amount <= 0) {
                    reject(new Error('Invalid amount'));
                    return;
                }

                self._apiRequest('POST', '/qr/generate', {
                    amount: amount.toFixed(2),
                    currency: options.currency || 'USD',
                    note: options.note || '',
                    metadata: options.metadata || {},
                    callback_url: options.callbackUrl || '',
                    source: 'widget'
                }).then(function(data) {
                    if (!data.success) {
                        reject(new Error(data.error || 'Payment creation failed'));
                        return;
                    }
                    var txnData = data.data || data;
                    self._openCheckoutModal(txnData, options);
                    resolve(txnData);
                }).catch(reject);
            });
        },

        _apiRequest: function(method, path, body) {
            var self = this;
            return new Promise(function(resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open(method, KHPAY_API_BASE + path, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Authorization', 'Bearer ' + self._config.publicKey);
                xhr.setRequestHeader('X-Widget-Origin', window.location.origin);
                xhr.timeout = 30000;

                xhr.onload = function() {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch(e) {
                        reject(new Error('Invalid response'));
                    }
                };
                xhr.onerror = function() { reject(new Error('Network error')); };
                xhr.ontimeout = function() { reject(new Error('Request timeout')); };

                xhr.send(body ? JSON.stringify(body) : null);
            });
        },

        _openCheckoutModal: function(txnData, options) {
            var self = this;
            var txnId = txnData.transaction_id;
            var payUrl = txnData.payment_url || (KHPAY_SITE_URL + '/pay/' + txnId);

            // Create overlay
            var overlay = document.createElement('div');
            overlay.id = 'khpay-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:khpayFadeIn .3s ease';

            // Create iframe container
            var container = document.createElement('div');
            container.style.cssText = 'width:100%;max-width:440px;height:90vh;max-height:680px;border-radius:16px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,.4);position:relative;animation:khpaySlideUp .3s ease';

            var iframe = document.createElement('iframe');
            iframe.src = payUrl + '?embed=1';
            iframe.style.cssText = 'width:100%;height:100%;border:none;background:#0f172a';
            iframe.allow = 'payment';
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');

            // Close button
            var closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:rgba(255,255,255,.1);border:none;color:#fff;font-size:24px;width:36px;height:36px;border-radius:50%;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center';
            closeBtn.onclick = function() { self._closeModal(overlay); };

            container.appendChild(closeBtn);
            container.appendChild(iframe);
            overlay.appendChild(container);

            // Click outside to close
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) self._closeModal(overlay);
            });

            // Inject animations
            if (!document.getElementById('khpay-styles')) {
                var style = document.createElement('style');
                style.id = 'khpay-styles';
                style.textContent = '@keyframes khpayFadeIn{from{opacity:0}to{opacity:1}}@keyframes khpaySlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
                document.head.appendChild(style);
            }

            document.body.appendChild(overlay);

            // Listen for messages from the iframe
            var messageHandler = function(event) {
                if (event.origin !== new URL(payUrl).origin) return;
                var data = event.data;
                if (!data || !data.type) return;

                if (data.type === 'khpay:payment_success') {
                    self._closeModal(overlay);
                    if (typeof self._config.onSuccess === 'function') {
                        self._config.onSuccess(data.payload);
                    }
                    if (typeof options.onSuccess === 'function') {
                        options.onSuccess(data.payload);
                    }
                    window.removeEventListener('message', messageHandler);
                }
                if (data.type === 'khpay:payment_failed' || data.type === 'khpay:payment_expired') {
                    self._closeModal(overlay);
                    if (typeof self._config.onError === 'function') {
                        self._config.onError(data.payload);
                    }
                    if (typeof options.onError === 'function') {
                        options.onError(data.payload);
                    }
                    window.removeEventListener('message', messageHandler);
                }
            };
            window.addEventListener('message', messageHandler);

            // Poll for payment status
            this._pollStatus(txnId, function(status) {
                if (status === 'paid') {
                    self._closeModal(overlay);
                    window.removeEventListener('message', messageHandler);
                    var payload = { transaction_id: txnId, status: 'paid' };
                    if (typeof self._config.onSuccess === 'function') self._config.onSuccess(payload);
                    if (typeof options.onSuccess === 'function') options.onSuccess(payload);
                } else if (status === 'expired' || status === 'failed') {
                    self._closeModal(overlay);
                    window.removeEventListener('message', messageHandler);
                    var payload2 = { transaction_id: txnId, status: status };
                    if (typeof self._config.onError === 'function') self._config.onError(payload2);
                    if (typeof options.onError === 'function') options.onError(payload2);
                }
            });
        },

        _pollStatus: function(txnId, callback) {
            var self = this;
            var interval = setInterval(function() {
                if (!document.getElementById('khpay-overlay')) {
                    clearInterval(interval);
                    return;
                }
                self._apiRequest('GET', '/qr/check/' + txnId).then(function(data) {
                    if (data.success && data.data) {
                        var status = data.data.status;
                        if (status !== 'pending') {
                            clearInterval(interval);
                            callback(status);
                        }
                    }
                }).catch(function() { /* ignore polling errors */ });
            }, 3000);
        },

        _closeModal: function(overlay) {
            if (overlay && overlay.parentNode) {
                overlay.style.opacity = '0';
                setTimeout(function() { overlay.parentNode && overlay.parentNode.removeChild(overlay); }, 200);
            }
            if (typeof this._config.onClose === 'function') this._config.onClose();
        },

        _mountButtons: function() {
            var self = this;
            var buttons = document.querySelectorAll('[data-khpay], [id="khpay-button"], .khpay-button');
            buttons.forEach(function(el) {
                var key = el.getAttribute('data-key') || self._config.publicKey;
                var amount = el.getAttribute('data-amount');
                var currency = el.getAttribute('data-currency') || 'USD';
                var note = el.getAttribute('data-note') || '';
                var label = el.getAttribute('data-label') || 'Pay $' + amount + ' ' + currency;

                if (!amount) return;

                // Style the button if it's empty
                if (!el.innerHTML.trim()) {
                    el.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:6px"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' + self._escapeHtml(label);
                    el.style.cssText = 'display:inline-flex;align-items:center;padding:12px 24px;background:#00b96b;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;transition:all .2s';
                    el.onmouseover = function() { this.style.background = '#00a35e'; };
                    el.onmouseout = function() { this.style.background = '#00b96b'; };
                }

                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (key) self._config.publicKey = key;
                    self.createPayment({ amount: amount, currency: currency, note: note }).catch(function(err) {
                        console.error('[KHPay]', err.message);
                    });
                });
            });
        },

        _escapeHtml: function(str) {
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(str));
            return div.innerHTML;
        }
    };

    // Expose globally
    window.KHPay = KHPay;

    // Auto-init on DOMContentLoaded if data attributes found
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            var autoButtons = document.querySelectorAll('[data-khpay][data-key]');
            if (autoButtons.length > 0) {
                KHPay.init({ publicKey: autoButtons[0].getAttribute('data-key') });
            }
        });
    } else {
        var autoButtons = document.querySelectorAll('[data-khpay][data-key]');
        if (autoButtons.length > 0) {
            KHPay.init({ publicKey: autoButtons[0].getAttribute('data-key') });
        }
    }

})(window, document);
