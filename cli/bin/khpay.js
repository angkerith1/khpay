#!/usr/bin/env node
/**
 * KHPay CLI — zero-dependency Node.js tool.
 *
 * Commands:
 *   khpay login                        Save API key (stored in ~/.khpay/config.json)
 *   khpay whoami                       Print current merchant + key status
 *   khpay logs [--tail] [--status=N]   List recent API calls
 *   khpay inspect <log-id>             Show full request/response for a log row
 *   khpay test <scenario>              Fire a test-mode charge (success|decline|gateway-down|fraud)
 *   khpay webhook test                 Trigger a test webhook to your configured URL
 *   khpay config                       Print current config location and values
 *
 * Usage:
 *   npm i -g @khpay/cli
 *   khpay login
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

// ── tiny HTTP helper (uses built-in fetch, Node 18+) ──────────────────────
async function api(method, pathname, { body, headers = {}, testMode = false } = {}) {
  const { base, key } = getConfig();
  if (!key) die('No API key configured. Run: khpay login');
  const url = base.replace(/\/+$/, '') + '/' + pathname.replace(/^\/+/, '');
  const h = {
    'Authorization': 'Bearer ' + key,
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
  return { status: res.status, body: json, headers: Object.fromEntries(res.headers) };
}

// ── prompt helper ─────────────────────────────────────────────────────────
function prompt(q, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (silent) {
      process.stdout.write(q);
      const onData = (c) => {
        c = c.toString();
        if (c === '\n' || c === '\r' || c === '\u0004') {
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false); process.stdin.pause();
          process.stdout.write('\n'); rl.close();
        } else process.stdout.write('*');
      };
      process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
    }
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

// ── utils ─────────────────────────────────────────────────────────────────
const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
};
const c = (color, s) => (process.stdout.isTTY ? COLOR[color] + s + COLOR.reset : s);
function die(msg, code = 1) { console.error(c('red', 'error: ') + msg); process.exit(code); }
function ok(msg)  { console.log(c('green', '✓ ') + msg); }
function info(msg){ console.log(c('dim', msg)); }

function statusColorCode(s) {
  if (s >= 200 && s < 300) return 'green';
  if (s >= 400 && s < 500) return 'yellow';
  return 'red';
}

// ── commands ──────────────────────────────────────────────────────────────
async function cmdLogin() {
  const cfg = loadConfig();
  const base = await prompt(`API base URL [${cfg.base_url || DEFAULT_BASE}]: `) || cfg.base_url || DEFAULT_BASE;
  const key  = await prompt('API key (ak_…): ');
  if (!/^ak_/.test(key)) die('API keys must start with ak_');
  saveConfig({ ...cfg, base_url: base, api_key: key });
  ok('Saved to ' + CFG_FILE);
  // Verify
  const res = await api('GET', 'me');
  if (res.status === 200) ok(`Authenticated as ${res.body.name || res.body.email || 'merchant'}`);
  else die(`Auth check failed (${res.status}): ${JSON.stringify(res.body)}`);
}

async function cmdWhoami() {
  const { base, key } = getConfig();
  console.log(`${c('bold', 'base:')} ${base}`);
  console.log(`${c('bold', 'key:')}  ${key ? key.slice(0, 8) + '***' : c('red', '(none)')}`);
  if (!key) return;
  const res = await api('GET', 'me');
  console.log(`${c('bold', 'status:')} ${c(statusColorCode(res.status), res.status)}`);
  console.log(JSON.stringify(res.body, null, 2));
}

async function cmdLogs(args) {
  const status = args.find((a) => a.startsWith('--status='))?.split('=')[1];
  const tail   = args.includes('--tail');
  // For now we use the public /transactions endpoint as a proxy; in the real
  // endpoint we'd expose /api/v1/logs. See below — stubs until server ships.
  const q = new URLSearchParams();
  if (status) q.set('status_code', status);
  const res = await api('GET', 'logs?' + q.toString());
  if (res.status === 404) {
    info('Note: /api/v1/logs not yet shipped on server. Open dashboard → API Logs meanwhile.');
    return;
  }
  if (res.status !== 200) die(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  const rows = Array.isArray(res.body.data) ? res.body.data : res.body;
  rows.slice(0, 30).forEach((r) => {
    const t = r.created_at || '';
    console.log(
      `${c('dim', t.padEnd(20))}  ` +
      `${r.method.padEnd(6)}  ` +
      `${c(statusColorCode(r.status), String(r.status).padEnd(4))}  ` +
      `${(r.duration_ms || '-').toString().padStart(5)}ms  ` +
      `${r.endpoint}`
    );
  });
  if (tail) info('\n--tail mode not yet implemented; re-run the command.');
}

async function cmdInspect(id) {
  if (!id) die('usage: khpay inspect <log-id>');
  const res = await api('GET', 'logs/' + encodeURIComponent(id));
  if (res.status === 404) die('Log not found (or /api/v1/logs/:id not shipped yet).');
  if (res.status !== 200) die(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  console.log(JSON.stringify(res.body, null, 2));
}

async function cmdTest(scenario) {
  const map = { success: 1, decline: 2, 'gateway-down': 3, fraud: 4 };
  const amount = map[scenario];
  if (!amount) die('usage: khpay test <success|decline|gateway-down|fraud>');
  const res = await api('POST', 'transactions', {
    body: {
      amount,
      currency: 'USD',
      description: 'khpay-cli test: ' + scenario,
    },
    testMode: true,
  });
  console.log(`${c('bold', 'status:')} ${c(statusColorCode(res.status), res.status)}`);
  console.log(JSON.stringify(res.body, null, 2));
}

async function cmdWebhookTest() {
  const res = await api('POST', 'webhooks/test', { body: {}, testMode: true });
  if (res.status === 200) ok('Test webhook fired. Check your receiver logs.');
  else console.log(`HTTP ${res.status}: ${JSON.stringify(res.body, null, 2)}`);
}

function cmdConfig() {
  const cfg = getConfig();
  console.log(`config file: ${CFG_FILE}`);
  console.log(`base_url:    ${cfg.base}`);
  console.log(`api_key:     ${cfg.key ? cfg.key.slice(0, 8) + '***' : '(none)'}`);
}

function cmdHelp() {
  console.log(`khpay v${VERSION} — KHPay command line

${c('bold', 'USAGE')}
  khpay <command> [args]

${c('bold', 'COMMANDS')}
  login                    Save API key to ~/.khpay/config.json
  whoami                   Show current merchant + key
  logs [--status=400]      List recent API calls
  inspect <log-id>         Show full request/response for a log
  test <scenario>          Fire a test charge (success|decline|gateway-down|fraud)
  webhook test             Fire a test webhook to your configured URL
  config                   Print current config
  help                     This message

${c('bold', 'ENV')}
  KHPAY_API_KEY            Override saved API key
  KHPAY_BASE_URL           Override API base URL

Docs: https://khpay.site/api-documentation
`);
}

// ── entry ─────────────────────────────────────────────────────────────────
(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'login':    return cmdLogin();
    case 'whoami':   return cmdWhoami();
    case 'logs':     return cmdLogs(rest);
    case 'inspect':  return cmdInspect(rest[0]);
    case 'test':     return cmdTest(rest[0]);
    case 'webhook':  return rest[0] === 'test' ? cmdWebhookTest() : cmdHelp();
    case 'config':   return cmdConfig();
    case '-v': case '--version': return console.log(VERSION);
    case undefined: case 'help': case '-h': case '--help': return cmdHelp();
    default: die(`Unknown command: ${cmd}. Run: khpay help`);
  }
})().catch((e) => die(e.stack || e.message));
