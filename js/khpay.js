/**
 * KHPAY JavaScript SDK
 *
 * Lightweight JS client for the KHPAY payment gateway API.
 * Works in both Node.js and browser environments.
 *
 * Usage (Node.js):
 *   const KHPay = require('./khpay');
 *   const client = new KHPay('your_api_key');
 *   const payment = await client.createPayment(10.00, 'USD', 'Order #123');
 *
 * Usage (Browser):
 *   <script src="khpay.js"></script>
 *   const client = new KHPay('your_api_key');
 */

class KHPay {
  constructor(apiKey, baseUrl = 'https://khpay.site/api/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  async createPayment(amount, currency = 'USD', note = '', callbackUrl = null, expiresIn = null) {
    const body = { amount, currency };
    if (note) body.note = note;
    if (callbackUrl) body.callback_url = callbackUrl;
    if (expiresIn) body.expires_in = expiresIn;
    return this._post('/qr/generate', body);
  }

  async checkPayment(transactionId) {
    return this._get(`/qr/check/${transactionId}`);
  }

  async expirePayment(transactionId) {
    return this._post(`/qr/expire/${transactionId}`);
  }

  async createBatchPayments(payments) {
    return this._post('/qr/batch-generate', { payments });
  }

  // ── Transactions ────────────────────────────────────────────────────────

  async getTransactions(status = '', page = 1, perPage = 20) {
    const params = { page, per_page: perPage };
    if (status) params.status = status;
    return this._get('/transactions', params);
  }

  async getTransaction(transactionId) {
    return this._get(`/transactions/${transactionId}`);
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async getWebhooks() {
    return this._get('/webhooks');
  }

  async createWebhook(url, events = ['payment.completed']) {
    return this._post('/webhooks', { url, events });
  }

  async deleteWebhook(id) {
    return this._delete(`/webhooks/${id}`);
  }

  // ── Scheduled Payments ──────────────────────────────────────────────────

  async createScheduledPayment(amount, frequency, currency = 'USD', note = '', maxRuns = null) {
    const body = { amount, frequency, currency };
    if (note) body.note = note;
    if (maxRuns) body.max_runs = maxRuns;
    return this._post('/scheduled-payments', body);
  }

  async getScheduledPayments(activeOnly = false) {
    return this._get('/scheduled-payments', activeOnly ? { active: '1' } : {});
  }

  async cancelScheduledPayment(id) {
    return this._delete(`/scheduled-payments/${id}`);
  }

  // ── Account ─────────────────────────────────────────────────────────────

  async me() {
    return this._get('/me');
  }

  async getStats(period = '30d') {
    return this._get('/stats/summary', { period });
  }

  // ── API Keys ────────────────────────────────────────────────────────────

  async rotateKey(expiresInDays = null) {
    const body = expiresInDays ? { expires_in_days: expiresInDays } : {};
    return this._post('/keys/rotate', body);
  }

  // ── Webhook Signature Verification ──────────────────────────────────────

  static async verifyWebhookSignature(payload, signature, secret) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      // Browser / modern Node
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      return hex === signature;
    }
    // Node.js fallback
    const crypto_node = require('crypto');
    const expected = crypto_node.createHmac('sha256', secret).update(payload).digest('hex');
    return expected === signature;
  }

  // ── HTTP Methods ────────────────────────────────────────────────────────

  async _get(path, params = {}) {
    let url = `${this.baseUrl}${path}`;
    const query = new URLSearchParams(params).toString();
    if (query) url += `?${query}`;
    return this._request('GET', url);
  }

  async _post(path, body = {}) {
    return this._request('POST', `${this.baseUrl}${path}`, body);
  }

  async _delete(path) {
    return this._request('DELETE', `${this.baseUrl}${path}`);
  }

  async _request(method, url, body = null) {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      'User-Agent': 'KHPAY-JS-SDK/1.0',
    };

    const opts = { method, headers };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
      const msg = data.error || data.message || `HTTP ${res.status}`;
      throw new Error(`KHPAY API error (${res.status}): ${msg}`);
    }

    return data;
  }
}

// Export for Node.js / CommonJS / ESM
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KHPay;
}
