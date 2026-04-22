<?php
/**
 * KHPAY PHP SDK
 *
 * Lightweight PHP client for the KHPAY payment gateway API.
 *
 * Usage:
 *   $khpay = new KHPay('your_api_key');
 *   $payment = $khpay->createPayment(10.00, 'USD', 'Order #123');
 *   $status  = $khpay->checkPayment($payment['transaction_id']);
 */

class KHPay {
    private string $apiKey;
    private string $baseUrl;
    private int $timeout;

    public function __construct(string $apiKey, string $baseUrl = 'https://khpay.site/api/v1', int $timeout = 30) {
        $this->apiKey  = $apiKey;
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeout = $timeout;
    }

    // ── Payments ─────────────────────────────────────────────────────────────

    /** Generate a QR payment */
    public function createPayment(float $amount, string $currency = 'USD', string $note = '', ?string $callbackUrl = null, ?int $expiresIn = null): array {
        $body = ['amount' => $amount, 'currency' => $currency];
        if ($note) $body['note'] = $note;
        if ($callbackUrl) $body['callback_url'] = $callbackUrl;
        if ($expiresIn) $body['expires_in'] = $expiresIn;
        return $this->post('/qr/generate', $body);
    }

    /** Check payment status */
    public function checkPayment(string $transactionId): array {
        return $this->get("/qr/check/$transactionId");
    }

    /** Expire a pending payment */
    public function expirePayment(string $transactionId): array {
        return $this->post("/qr/expire/$transactionId");
    }

    /** Generate batch payments (max 100) */
    public function createBatchPayments(array $payments): array {
        return $this->post('/qr/batch-generate', ['payments' => $payments]);
    }

    // ── Transactions ─────────────────────────────────────────────────────────

    /** List transactions */
    public function getTransactions(string $status = '', int $page = 1, int $perPage = 20): array {
        $params = ['page' => $page, 'per_page' => $perPage];
        if ($status) $params['status'] = $status;
        return $this->get('/transactions', $params);
    }

    /** Get single transaction */
    public function getTransaction(string $transactionId): array {
        return $this->get("/transactions/$transactionId");
    }

    // ── Webhooks ─────────────────────────────────────────────────────────────

    /** List webhooks */
    public function getWebhooks(): array {
        return $this->get('/webhooks');
    }

    /** Create a webhook */
    public function createWebhook(string $url, array $events = ['payment.completed']): array {
        return $this->post('/webhooks', ['url' => $url, 'events' => $events]);
    }

    /** Delete a webhook */
    public function deleteWebhook(int $id): array {
        return $this->delete("/webhooks/$id");
    }

    // ── Scheduled Payments ───────────────────────────────────────────────────

    /** Create a recurring scheduled payment */
    public function createScheduledPayment(float $amount, string $frequency, string $currency = 'USD', string $note = '', ?int $maxRuns = null): array {
        $body = ['amount' => $amount, 'frequency' => $frequency, 'currency' => $currency];
        if ($note) $body['note'] = $note;
        if ($maxRuns) $body['max_runs'] = $maxRuns;
        return $this->post('/scheduled-payments', $body);
    }

    /** List scheduled payments */
    public function getScheduledPayments(bool $activeOnly = false): array {
        return $this->get('/scheduled-payments', $activeOnly ? ['active' => '1'] : []);
    }

    /** Deactivate a scheduled payment */
    public function cancelScheduledPayment(int $id): array {
        return $this->delete("/scheduled-payments/$id");
    }

    // ── Account ──────────────────────────────────────────────────────────────

    /** Get account info */
    public function me(): array {
        return $this->get('/me');
    }

    /** Get stats summary */
    public function getStats(string $period = '30d'): array {
        return $this->get('/stats/summary', ['period' => $period]);
    }

    // ── API Keys ─────────────────────────────────────────────────────────────

    /** Rotate API key */
    public function rotateKey(?int $expiresInDays = null): array {
        $body = $expiresInDays ? ['expires_in_days' => $expiresInDays] : [];
        return $this->post('/keys/rotate', $body);
    }

    // ── Webhook Signature Verification ───────────────────────────────────────

    /** Verify incoming webhook signature */
    public static function verifyWebhookSignature(string $payload, string $signature, string $secret): bool {
        $expected = hash_hmac('sha256', $payload, $secret);
        return hash_equals($expected, $signature);
    }

    // ── HTTP Methods ─────────────────────────────────────────────────────────

    private function get(string $path, array $query = []): array {
        $url = $this->baseUrl . $path;
        if ($query) $url .= '?' . http_build_query($query);
        return $this->request('GET', $url);
    }

    private function post(string $path, array $body = []): array {
        return $this->request('POST', $this->baseUrl . $path, $body);
    }

    private function delete(string $path): array {
        return $this->request('DELETE', $this->baseUrl . $path);
    }

    private function request(string $method, string $url, ?array $body = null): array {
        $ch = curl_init($url);
        $headers = [
            'Authorization: Bearer ' . $this->apiKey,
            'Accept: application/json',
            'User-Agent: KHPAY-PHP-SDK/1.0',
        ];

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CUSTOMREQUEST  => $method,
        ]);

        if ($body !== null && $method !== 'GET') {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($error) {
            throw new \RuntimeException("KHPAY API request failed: $error");
        }

        $data = json_decode($response, true);
        if ($httpCode >= 400) {
            $msg = $data['error'] ?? $data['message'] ?? "HTTP $httpCode";
            throw new \RuntimeException("KHPAY API error ($httpCode): $msg");
        }

        return $data ?? [];
    }
}
