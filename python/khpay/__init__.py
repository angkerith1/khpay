"""
KHPAY Python SDK

Lightweight Python client for the KHPAY payment gateway API.

Usage:
    from khpay import KHPay
    client = KHPay('your_api_key')
    payment = client.create_payment(10.00, 'USD', 'Order #123')
    status = client.check_payment(payment['data']['transaction_id'])
"""

import hashlib
import hmac
import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

__version__ = '1.0.0'


class KHPayError(Exception):
    """KHPAY API error."""
    def __init__(self, message: str, status_code: int = 0):
        self.status_code = status_code
        super().__init__(message)


class KHPay:
    def __init__(self, api_key: str, base_url: str = 'https://khpay.site/api/v1', timeout: int = 30):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout

    # ── Payments ──────────────────────────────────────────────────────────────

    def create_payment(self, amount: float, currency: str = 'USD', note: str = '',
                       callback_url: Optional[str] = None, expires_in: Optional[int] = None) -> Dict:
        body: Dict[str, Any] = {'amount': amount, 'currency': currency}
        if note:
            body['note'] = note
        if callback_url:
            body['callback_url'] = callback_url
        if expires_in:
            body['expires_in'] = expires_in
        return self._post('/qr/generate', body)

    def check_payment(self, transaction_id: str) -> Dict:
        return self._get(f'/qr/check/{transaction_id}')

    def expire_payment(self, transaction_id: str) -> Dict:
        return self._post(f'/qr/expire/{transaction_id}')

    def create_batch_payments(self, payments: List[Dict]) -> Dict:
        return self._post('/qr/batch-generate', {'payments': payments})

    # ── Transactions ──────────────────────────────────────────────────────────

    def get_transactions(self, status: str = '', page: int = 1, per_page: int = 20) -> Dict:
        params: Dict[str, Any] = {'page': page, 'per_page': per_page}
        if status:
            params['status'] = status
        return self._get('/transactions', params)

    def get_transaction(self, transaction_id: str) -> Dict:
        return self._get(f'/transactions/{transaction_id}')

    # ── Webhooks ──────────────────────────────────────────────────────────────

    def get_webhooks(self) -> Dict:
        return self._get('/webhooks')

    def create_webhook(self, url: str, events: Optional[List[str]] = None) -> Dict:
        return self._post('/webhooks', {'url': url, 'events': events or ['payment.completed']})

    def delete_webhook(self, webhook_id: int) -> Dict:
        return self._delete(f'/webhooks/{webhook_id}')

    # ── Scheduled Payments ────────────────────────────────────────────────────

    def create_scheduled_payment(self, amount: float, frequency: str, currency: str = 'USD',
                                  note: str = '', max_runs: Optional[int] = None) -> Dict:
        body: Dict[str, Any] = {'amount': amount, 'frequency': frequency, 'currency': currency}
        if note:
            body['note'] = note
        if max_runs:
            body['max_runs'] = max_runs
        return self._post('/scheduled-payments', body)

    def get_scheduled_payments(self, active_only: bool = False) -> Dict:
        return self._get('/scheduled-payments', {'active': '1'} if active_only else {})

    def cancel_scheduled_payment(self, payment_id: int) -> Dict:
        return self._delete(f'/scheduled-payments/{payment_id}')

    # ── Account ───────────────────────────────────────────────────────────────

    def me(self) -> Dict:
        return self._get('/me')

    def get_stats(self, period: str = '30d') -> Dict:
        return self._get('/stats/summary', {'period': period})

    # ── API Keys ──────────────────────────────────────────────────────────────

    def rotate_key(self, expires_in_days: Optional[int] = None) -> Dict:
        body = {'expires_in_days': expires_in_days} if expires_in_days else {}
        return self._post('/keys/rotate', body)

    # ── Webhook Signature Verification ────────────────────────────────────────

    @staticmethod
    def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    # ── HTTP Methods ──────────────────────────────────────────────────────────

    def _get(self, path: str, params: Optional[Dict] = None) -> Dict:
        url = f'{self.base_url}{path}'
        if params:
            url += '?' + urlencode(params)
        return self._request('GET', url)

    def _post(self, path: str, body: Optional[Dict] = None) -> Dict:
        return self._request('POST', f'{self.base_url}{path}', body)

    def _delete(self, path: str) -> Dict:
        return self._request('DELETE', f'{self.base_url}{path}')

    def _request(self, method: str, url: str, body: Optional[Dict] = None) -> Dict:
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json',
            'User-Agent': f'KHPAY-Python-SDK/{__version__}',
        }

        data = None
        if body is not None and method != 'GET':
            headers['Content-Type'] = 'application/json'
            data = json.dumps(body).encode('utf-8')

        req = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except HTTPError as e:
            body_text = e.read().decode('utf-8', errors='replace')
            try:
                err_data = json.loads(body_text)
                msg = err_data.get('error', err_data.get('message', f'HTTP {e.code}'))
            except (json.JSONDecodeError, ValueError):
                msg = f'HTTP {e.code}: {body_text[:200]}'
            raise KHPayError(f'KHPAY API error ({e.code}): {msg}', e.code) from e
