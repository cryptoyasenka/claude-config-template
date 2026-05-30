#!/usr/bin/env node
// Behavioral tests for the live auto-compact-nudge.js PostToolUse hook.
// Drives the hook as a real subprocess with an isolated sandbox HOME/TEMP so it
// reads a fake metrics bridge file + optional auto-continue.flag without touching
// real session state. Guards the 2026-05-29 changes: thresholds raised to
// PREP=42 / CRITICAL=33, and the night-mode critTail branch (keep-working +
// delegate to sub-agents) vs the interactive tail (run /compact now).
//
// Run:  node tests/auto-compact-nudge.test.js
// Target a specific hook copy:  AC_NUDGE_HOOK=/abs/auto-compact-nudge.js node tests/auto-compact-nudge.test.js

const { execFileSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = process.env.AC_NUDGE_HOOK
  || path.join(__dirname, '..', 'hooks', 'auto-compact-nudge.js');

const SID = 'testsid';
let pass = 0, fail = 0;

// Run the hook in an isolated sandbox. The hook resolves os.homedir() (flag) and
// os.tmpdir() (metrics + markers); we point USERPROFILE/HOME/TEMP/TMP at a fresh
// temp dir so nothing leaks into the real session.
function run({ remaining, used = 50, ageSec = 0, night = false, prepMarker = false, critMarker = false }) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-test-'));
  fs.mkdirSync(path.join(sandbox, '.claude', 'snapshots'), { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);
  fs.writeFileSync(
    path.join(sandbox, `claude-ctx-${SID}.json`),
    JSON.stringify({ remaining_percentage: remaining, used_pct: used, timestamp: nowSec - ageSec })
  );
  if (night) fs.writeFileSync(path.join(sandbox, '.claude', 'auto-continue.flag'), '');
  const prepPath = path.join(sandbox, `claude-ctx-${SID}-prep-nudged.json`);
  const critPath = path.join(sandbox, `claude-ctx-${SID}-critical-nudged.json`);
  if (prepMarker) fs.writeFileSync(prepPath, '{}');
  if (critMarker) fs.writeFileSync(critPath, '{}');

  const env = { ...process.env, USERPROFILE: sandbox, HOME: sandbox, TEMP: sandbox, TMP: sandbox };
  let out = '';
  try {
    out = execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: SID }), env, encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '').toString();
  }
  let msg = '';
  if (out.trim()) {
    try { msg = JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch (e) { msg = out; }
  }
  return { msg, prepExists: fs.existsSync(prepPath), critExists: fs.existsSync(critPath) };
}

function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); fail++; }
}

console.log('threshold firing (PREP=42 / CRITICAL=33):');
t('N1 remaining 50% → no fire', () => {
  assert.strictEqual(run({ remaining: 50 }).msg, '');
});
t('N2 remaining 43% → no fire (just above PREP)', () => {
  assert.strictEqual(run({ remaining: 43 }).msg, '');
});
t('N3 remaining 42% → PREP fires, prep marker set, crit not', () => {
  const r = run({ remaining: 42 });
  assert.ok(/CONTEXT CHECKPOINT \(Stage 1\/2\)/.test(r.msg), 'expected PREP message');
  assert.ok(r.prepExists, 'prep marker should exist');
  assert.ok(!r.critExists, 'crit marker should NOT exist');
});
t('N4 remaining 33% → CRITICAL fires + both markers set', () => {
  const r = run({ remaining: 33 });
  assert.ok(/CONTEXT CRITICAL \(Stage 2\/2\)/.test(r.msg), 'expected CRITICAL message');
  assert.ok(r.critExists && r.prepExists, 'both markers should exist');
});

console.log('night-mode critTail branch (2026-05-29 change):');
t('N5 CRITICAL + flag → keep-working / sub-agents tail', () => {
  const r = run({ remaining: 30, night: true });
  assert.ok(/KEEP WORKING/.test(r.msg), 'expected night KEEP WORKING tail');
  assert.ok(/sub-agents/.test(r.msg), 'expected delegate-to-sub-agents advice');
  assert.ok(!/safe manual-\/compact window/.test(r.msg), 'must NOT show interactive tail');
});
t('N6 CRITICAL + no flag → interactive run-/compact-now tail', () => {
  const r = run({ remaining: 30, night: false });
  assert.ok(/safe manual-\/compact window/.test(r.msg), 'expected interactive tail');
  assert.ok(!/KEEP WORKING/.test(r.msg), 'must NOT show night tail');
});

console.log('idempotency + re-arm + staleness:');
t('N7 PREP already fired (marker present) → no re-fire', () => {
  assert.strictEqual(run({ remaining: 42, prepMarker: true }).msg, '');
});
t('N8 remaining 70% with markers → re-arm clears both markers', () => {
  const r = run({ remaining: 70, prepMarker: true, critMarker: true });
  assert.strictEqual(r.msg, '');
  assert.ok(!r.prepExists && !r.critExists, 'markers should be deleted on re-arm');
});
t('N9 stale gauge (>60s old) → no fire', () => {
  assert.strictEqual(run({ remaining: 33, ageSec: 120 }).msg, '');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
