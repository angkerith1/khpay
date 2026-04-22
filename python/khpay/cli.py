"""KHPay CLI — mirrors the Node `khpay` CLI for Python users.

Usage:
    pip install khpay
    khpay login
    khpay whoami
    khpay logs --status 400
    khpay inspect 1842
    khpay test success
    khpay webhook test
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://khpay.site/api/v1"
CONFIG_DIR = Path.home() / ".khpay"
CONFIG_FILE = CONFIG_DIR / "config.json"


# ── Config ────────────────────────────────────────────────────────────────────

def _load_config() -> Dict[str, str]:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
    return {}


def _save_config(cfg: Dict[str, str]) -> None:
    CONFIG_DIR.mkdir(exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def _get_credentials() -> tuple[str, str]:
    api_key = os.environ.get("KHPAY_API_KEY")
    base_url = os.environ.get("KHPAY_BASE_URL")
    if not api_key or not base_url:
        cfg = _load_config()
        api_key = api_key or cfg.get("api_key", "")
        base_url = base_url or cfg.get("base_url", DEFAULT_BASE_URL)
    if not api_key:
        print("Not logged in. Run: khpay login", file=sys.stderr)
        sys.exit(2)
    return api_key, base_url or DEFAULT_BASE_URL


# ── HTTP ──────────────────────────────────────────────────────────────────────

def _request(
    method: str,
    path: str,
    body: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    api_key, base_url = _get_credentials()
    url = f"{base_url}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "KHPay-Python-CLI/0.1.0",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = {"error": f"HTTP {exc.code}", "body": raw[:400]}
        print(json.dumps(parsed, indent=2))
        sys.exit(1)
    except URLError as exc:
        print(f"Network error: {exc.reason}", file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(raw)
    except ValueError:
        return {"raw": raw}


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_login(_args: argparse.Namespace) -> None:
    print("Paste your KHPay API key (starts with ak_).")
    key = getpass.getpass("API key: ").strip()
    if not key.startswith("ak_"):
        print("Invalid key format.", file=sys.stderr)
        sys.exit(1)
    base = input(f"Base URL [{DEFAULT_BASE_URL}]: ").strip() or DEFAULT_BASE_URL
    _save_config({"api_key": key, "base_url": base})
    print(f"Saved to {CONFIG_FILE}")


def cmd_whoami(_args: argparse.Namespace) -> None:
    res = _request("GET", "/me")
    data = res.get("data", res)
    print(json.dumps(data, indent=2))


def cmd_logs(args: argparse.Namespace) -> None:
    qs: Dict[str, Any] = {"limit": args.limit}
    if args.status is not None:
        qs["status_code"] = args.status
    res = _request("GET", f"/logs?{urlencode(qs)}")
    rows = res.get("data", [])
    if not rows:
        print("No logs.")
        return
    print(f"{'ID':>6}  {'METHOD':<6}  {'STATUS':>6}  {'MS':>5}  ENDPOINT")
    print("-" * 72)
    for r in rows:
        print(
            f"{r.get('id', ''):>6}  "
            f"{r.get('method', ''):<6}  "
            f"{r.get('status', ''):>6}  "
            f"{r.get('duration_ms', ''):>5}  "
            f"{r.get('endpoint', '')}"
        )


def cmd_inspect(args: argparse.Namespace) -> None:
    res = _request("GET", f"/logs/{args.id}")
    print(json.dumps(res.get("data", res), indent=2))


_TEST_AMOUNTS = {
    "success": "1.00",
    "decline": "2.00",
    "gateway-down": "3.00",
    "fraud": "4.00",
}


def cmd_test(args: argparse.Namespace) -> None:
    if args.scenario not in _TEST_AMOUNTS:
        print(f"Unknown scenario. Use one of: {', '.join(_TEST_AMOUNTS)}", file=sys.stderr)
        sys.exit(2)
    amount = _TEST_AMOUNTS[args.scenario]
    res = _request(
        "POST",
        "/qr/generate",
        body={"amount": amount, "currency": "USD", "note": f"CLI test: {args.scenario}"},
        extra_headers={"X-Test-Mode": "1"},
    )
    print(json.dumps(res, indent=2))


def cmd_webhook_test(args: argparse.Namespace) -> None:
    body: Dict[str, Any] = {}
    if args.url:
        body["url"] = args.url
    res = _request("POST", "/webhooks/test", body=body or None)
    print(json.dumps(res, indent=2))


def cmd_config(_args: argparse.Namespace) -> None:
    cfg = _load_config()
    if not cfg:
        print("No config. Run: khpay login")
        return
    key = cfg.get("api_key", "")
    masked = (key[:7] + "***" + key[-4:]) if len(key) > 12 else "***"
    print(f"Config file: {CONFIG_FILE}")
    print(f"API key:     {masked}")
    print(f"Base URL:    {cfg.get('base_url', DEFAULT_BASE_URL)}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(prog="khpay", description="KHPay CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("login", help="Save API key to ~/.khpay/config.json").set_defaults(func=cmd_login)
    sub.add_parser("whoami", help="Show current account").set_defaults(func=cmd_whoami)
    sub.add_parser("config", help="Show saved config").set_defaults(func=cmd_config)

    p_logs = sub.add_parser("logs", help="List recent API requests")
    p_logs.add_argument("--limit", type=int, default=30)
    p_logs.add_argument("--status", type=int, help="Filter by HTTP status code")
    p_logs.set_defaults(func=cmd_logs)

    p_inspect = sub.add_parser("inspect", help="Inspect full request/response for a log ID")
    p_inspect.add_argument("id", type=int)
    p_inspect.set_defaults(func=cmd_inspect)

    p_test = sub.add_parser("test", help="Fire a test transaction (no real money)")
    p_test.add_argument(
        "scenario",
        choices=list(_TEST_AMOUNTS.keys()),
        help="Test scenario: success | decline | gateway-down | fraud",
    )
    p_test.set_defaults(func=cmd_test)

    p_webhook = sub.add_parser("webhook", help="Webhook utilities")
    wsub = p_webhook.add_subparsers(dest="wcmd", required=True)
    p_wt = wsub.add_parser("test", help="Trigger a test webhook delivery")
    p_wt.add_argument("--url", help="Override webhook URL for this test")
    p_wt.set_defaults(func=cmd_webhook_test)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
