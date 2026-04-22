#!/usr/bin/env node
/**
 * KHPay CLI — zero-dependency Node.js tool.
 *
 * Commands:
 *   khpay                              Show banner + help
 *   khpay login                        Interactive: save API key + base URL
 *   khpay whoami                       Print current merchant + key status
 *   khpay qr <amount> [note]           Generate a QR (uses test mode for $1-$4)
 *   khpay logs [--status=400]          List recent API calls
 *   khpay inspect <log-id>             Full request/response for a log row
 *   khpay test <scenario>              Magic $1-$4 (success|decline|gateway-down|fraud)
 *   khpay webhook test                 Trigger a test webhook to your configured URL
 *   khpay config show                  Print current config
 *   khpay config api [<key>]           Set API key (interactive if omitted)
 *   khpay config url [<url>]           Set API base URL
 *   khpay config clear                 Delete saved config
 *   khpay -v | --version               Print CLI version
 *
 * Install: npm install -g khpay
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const readline = require('readline');

const VERSION  = require('../package.json').version;
const CFG_DIR  = path.join(os.homedir(), '.khpay');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
const DEFAULT_BASE = 'https://khpay.site/api/v1';

// ── colors ────────────────────────────────────────────────────────────────
const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m',
};
const TTY = process.stdout.isTTY;
const c = (color, s) => (TTY ? COLOR[color] + s + COLOR.reset : s);

// ── banner ────────────────────────────────────────────────────────────────
function banner() {
  const line = c('cyan', '━'.repeat(58));
  console.log([
    '',
    line,
    c('bold', '  ██╗  ██╗██╗  ██╗██████╗  █████╗ ██╗   ██╗'),
    c('bold', '  ██║ ██╔╝██║  ██║██╔══██╗██╔══██╗╚██╗ ██╔╝'),
    c('bold', '  █████╔╝ ███████║██████╔╝███████║ ╚████╔╝ '),
    c('bold', '  ██╔═██╗ ██╔══██║██╔═══╝ ██╔══██║  ╚██╔╝  '),
    c('bold', '  ██║  ██╗██║  ██║██║     ██║  ██║   ██║   '),
    c('bold', '  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   '),
    '',
    c('dim', `  CLI v${VERSION}  ·  Cambodia Payment Gateway  ·  khpay.site`),
    line,
    '',
  ].join('\n'));
}

// ── config ────────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(CFG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
function getConfig() {
  const cfg = loadConfig();
  const base  = process.env.KHPAY_BASE_URL || cfg.base_url || DEFAULT_BASE;
  const key   = process.env.KHPAY_API_KEY  || cfg.api_key  || '';
  return { base, key, raw: cfg };
}
function maskKey(k) {
  if (!k) return c('red', '(none)');
  if (k.length < 12) return '***';
  return k.slice(0, 7) + '***' + k.slice(-4);
}

// ── HTTP ─────────────────────────────────────────────────────────────────
async function api(method, pathname, { body, headers = {}, testMode = false } = {}) {
  const { base, key } = getConfig();
  if (!key) die('No API key configured. Run: ' + c('bold', 'khpay login') + ' or ' + c('bold', 'khpay config api'));
  const url = base.replace(/\/+$/, '') + '/' + pathname.replace(/^\/+/, '');
  const h = {
    'Authorization': 'Bearer ' + key,
    'Accept':        'application/json',
    'Content-Type':  'application/json',
    'User-Agent':    'khpay-cli/' + VERSION,
    'X-Request-ID':  'cli_' + Math.random().toString(36).slice(2, 12),
    ...headers,
  };
  if (testMode) h['X-Test-Mode'] = '1';
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    die('Network error: ' + e.message);
  }
  const text = await res.text();
  let json;  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ── prompts / helpers ─────────────────────────────────────────────────────
function prompt(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}
function die(msg, code = 1) { console.error(c('red', 'error: ') + msg); process.exit(code); }
function ok(msg)   { console.log(c('green', '✓ ') + msg); }
function info(msg) { console.log(c('dim', msg)); }
function warn(msg) { console.log(c('yellow', '! ') + msg); }
function kv(label, value, color) {
  const lbl = (label + ':').padEnd(12);
  console.log('  ' + c('bold', lbl) + (color ? c(color, String(value)) : String(value)));
}
function statusColorCode(s) {
  if (s >= 200 && s < 300) return 'green';
  if (s >= 400 && s < 500) return 'yellow';
  return 'red';
}

// ── commands: auth ────────────────────────────────────────────────────────
async function cmdLogin() {
  banner();
  const cfg = loadConfig();
  const base = await prompt(`API base URL [${cfg.base_url || DEFAULT_BASE}]: `) || cfg.base_url || DEFAULT_BASE;
  const key  = await prompt('API key (starts with ak_): ');
  if (!/^ak_/.test(key)) die('API keys must start with ak_');
  saveConfig({ ...cfg, base_url: base, api_key: key });
  ok('Saved to ' + CFG_FILE);
  const res = await api('GET', 'me');
  if (res.status === 200) {
    const data = res.body.data || res.body;
    ok(`Authenticated as ${c('bold', data.name || data.email || 'merchant')}`);
  } else {
    warn(`Saved, but auth check returned HTTP ${res.status}. Re-check the key.`);
  }
}

async function cmdWhoami() {
  const { base, key } = getConfig();
  console.log();
  kv('base', base);
  kv('key',  maskKey(key));
  if (!key) return;
  const res = await api('GET', 'me');
  kv('status', res.status, statusColorCode(res.status));
  console.log();
  console.log(JSON.stringify(res.body, null, 2));
}

// ── commands: config ──────────────────────────────────────────────────────
async function cmdConfig(rest) {
  const sub = rest[0] || 'show';
  switch (sub) {
    case 'show':  return cfgShow();
    case 'api':   return cfgApi(rest[1]);
    case 'url':   return cfgUrl(rest[1]);
    case 'clear': return cfgClear();
    default: die('Unknown: config ' + sub + '. Try: show | api | url | clear');
  }
}
function cfgShow() {
  const { base, key, raw } = getConfig();
  console.log();
  console.log(c('bold', '  KHPay configuration'));
  console.log(c('dim',  '  ─────────────────────'));
  kv('file',     CFG_FILE);
  kv('base_url', base);
  kv('api_key',  maskKey(key));
  if (process.env.KHPAY_API_KEY)  info('  (api_key currently overridden by KHPAY_API_KEY env)');
  if (process.env.KHPAY_BASE_URL) info('  (base_url currently overridden by KHPAY_BASE_URL env)');
  if (!raw.api_key && !process.env.KHPAY_API_KEY) {
    console.log();
    info('  Not configured. Set a key with:  khpay config api');
  }
  console.log();
}
async function cfgApi(arg) {
  let key = arg;
  if (!key) {
    banner();
    console.log(c('dim', '  Get your API key from: https://khpay.site/dashboard/settings'));
    console.log();
    key = await prompt('API key (ak_…): ');
  }
  if (!/^ak_/.test(key)) die('API keys must start with ak_');
  const cfg = loadConfig();
  saveConfig({ ...cfg, api_key: key });
  ok('API key saved to ' + CFG_FILE);
  info('  Verifying against server…');
  const res = await api('GET', 'me');
  if (res.status === 200) {
    const data = res.body.data || res.body;
    ok(`Authenticated as ${c('bold', data.name || data.email || 'merchant')}`);
  } else {
    warn(`Saved, but verification returned HTTP ${res.status}.`);
  }
}
async function cfgUrl(arg) {
  const url = arg || (await prompt(`API base URL [${DEFAULT_BASE}]: `)) || DEFAULT_BASE;
  if (!/^https?:\/\//.test(url)) die('URL must start with http:// or https://');
  const cfg = loadConfig();
  saveConfig({ ...cfg, base_url: url });
  ok('Base URL saved: ' + url);
}
function cfgClear() {
  if (fs.existsSync(CFG_FILE)) { fs.unlinkSync(CFG_FILE); ok('Config deleted.'); }
  else info('No config to delete.');
}

// ── commands: qr / test ───────────────────────────────────────────────────
async function cmdQr(rest) {
  const amount = parseFloat(rest[0]);
  if (!(amount > 0)) die('usage: khpay qr <amount> [note]   e.g. khpay qr 1 "test payment"');
  const note = rest.slice(1).join(' ') || 'khpay-cli QR';
  const isTestAmount = [1, 2, 3, 4].includes(amount);
  const res = await api('POST', 'qr/generate', {
    body: { amount, currency: 'USD', note },
    testMode: isTestAmount,
  });
  console.log();
  if (res.status !== 200 || !res.body?.success) {
    kv('status', res.status, statusColorCode(res.status));
    console.log(JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  const d = res.body.data || {};
  ok('QR generated' + (isTestAmount ? c('dim', '   (test mode)') : ''));
  console.log();
  kv('txn_id',      d.transaction_id || '-');
  kv('amount',      `$${amount.toFixed(2)} ${d.currency || 'USD'}`);
  kv('status',      d.status || '-', d.status === 'pending' ? 'yellow' : 'green');
  kv('payment_url', d.payment_url || '-', 'cyan');
  kv('qr_image',    d.qr_url || '-', 'cyan');
  if (d.expires_at) kv('expires', d.expires_at);
  console.log();
  info('  Open payment_url in a browser, or scan qr_image to pay.');
  console.log();
}

async function cmdTest(scenario) {
  const map = { success: 1, decline: 2, 'gateway-down': 3, fraud: 4 };
  const amount = map[scenario];
  if (!amount) die('usage: khpay test <success|decline|gateway-down|fraud>');
  return cmdQr([String(amount), `khpay-cli test: ${scenario}`]);
}

// ── commands: logs ────────────────────────────────────────────────────────
async function cmdLogs(args) {
  const status = args.find((a) => a.startsWith('--status='))?.split('=')[1];
  const limit  = args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '30';
  const q = new URLSearchParams();
  if (status) q.set('status_code', status);
  q.set('limit', limit);
  const res = await api('GET', 'logs?' + q.toString());
  if (res.status === 404) return info('Note: /api/v1/logs not shipped on this server yet.');
  if (res.status !== 200) die(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const rows = Array.isArray(res.body.data) ? res.body.data : res.body;
  if (!rows.length) return info('No logs yet.');
  console.log();
  console.log(c('bold', '  ID       METHOD  STATUS   MS    ENDPOINT'));
  console.log(c('dim',  '  ─────────────────────────────────────────────────────────'));
  rows.forEach((r) => {
    console.log(
      '  ' + String(r.id ?? '-').padStart(6) + '   ' +
      String(r.method || '-').padEnd(6) + '  ' +
      c(statusColorCode(r.status), String(r.status).padEnd(6)) + '   ' +
      String(r.duration_ms ?? '-').padStart(4) + '  ' +
      (r.endpoint || '-')
    );
  });
  console.log();
}

async function cmdInspect(id) {
  if (!id) die('usage: khpay inspect <log-id>');
  const res = await api('GET', 'logs/' + encodeURIComponent(id));
  if (res.status === 404) die('Log not found (or /api/v1/logs/:id not shipped yet).');
  if (res.status !== 200) die(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  console.log(JSON.stringify(res.body.data || res.body, null, 2));
}

// ── commands: webhook ─────────────────────────────────────────────────────
async function cmdWebhookTest() {
  const res = await api('POST', 'webhooks/test', { body: {}, testMode: true });
  if (res.status === 200) ok('Test webhook fired. Check your receiver logs.');
  else console.log(`HTTP ${res.status}: ${JSON.stringify(res.body, null, 2)}`);
}

// ── help ──────────────────────────────────────────────────────────────────
function cmdHelp() {
  banner();
  console.log(c('bold', '  USAGE'));
  console.log('    khpay <command> [args]');
  console.log();
  console.log(c('bold', '  GETTING STARTED'));
  console.log('    khpay login                  Interactive setup (key + base URL)');
  console.log('    khpay whoami                 Verify authentication');
  console.log();
  console.log(c('bold', '  PAYMENTS'));
  console.log('    khpay qr <amount> [note]     Generate a QR for any amount');
  console.log('    khpay test <scenario>        Magic $1-$4  (success|decline|gateway-down|fraud)');
  console.log();
  console.log(c('bold', '  OBSERVABILITY'));
  console.log('    khpay logs [--status=400]    List recent API calls');
  console.log('    khpay inspect <log-id>       Full request/response for a log row');
  console.log('    khpay webhook test           Fire a test webhook');
  console.log();
  console.log(c('bold', '  CONFIG'));
  console.log('    khpay config show            Print current config');
  console.log('    khpay config api [<key>]     Set API key (interactive if omitted)');
  console.log('    khpay config url [<url>]     Set API base URL');
  console.log('    khpay config clear           Delete saved config');
  console.log();
  console.log(c('bold', '  ENVIRONMENT'));
  console.log('    KHPAY_API_KEY                Override saved API key');
  console.log('    KHPAY_BASE_URL               Override API base URL');
  console.log();
  console.log(c('dim', '  Docs:   https://khpay.site/api-documentation.php'));
  console.log(c('dim', '  Issues: https://github.com/angkerith1/khpay/issues'));
  console.log();
}

// ── entry ─────────────────────────────────────────────────────────────────
(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'login':    return cmdLogin();
    case 'whoami':   return cmdWhoami();
    case 'qr':       return cmdQr(rest);
    case 'test':     return cmdTest(rest[0]);
    case 'logs':     return cmdLogs(rest);
    case 'inspect':  return cmdInspect(rest[0]);
    case 'webhook':  return rest[0] === 'test' ? cmdWebhookTest() : cmdHelp();
    case 'config':   return cmdConfig(rest);
    case '-v': case '--version': return console.log(VERSION);
    case undefined: case 'help': case '-h': case '--help': return cmdHelp();
    default: die(`Unknown command: ${cmd}. Run: khpay help`);
  }
})().catch((e) => die(e.stack || e.message));
