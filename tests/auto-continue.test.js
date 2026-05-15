#!/usr/bin/env node
// Smoke tests for the night-mode auto-continue marker detection.
//
// The bug these guard against: a raw byte-scan of the transcript matched the
// literal "AUTO_CONTINUE: DONE" wherever it appeared — including the hook's own
// injected feedback (a user-role turn), post-compact summaries, tool results
// and Claude merely discussing the protocol — causing the verifier to spawn
// every iteration and the run to false-stop. Detection must be role-aware:
// only the LAST assistant turn, marker alone on its final line, counts.
//
// Run:  node tests/auto-continue.test.js
// Point at a specific hook copy:  AC_HOOK=/abs/path/auto-continue.js node tests/auto-continue.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = process.env.AC_HOOK
  || path.join(__dirname, '..', 'hooks', 'auto-continue.js');
const ac = require(HOOK);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-test-'));
let pass = 0, fail = 0;

function jl(rows) {
  // Write rows as a JSONL transcript file, return its path.
  const p = path.join(TMP, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  return p;
}
const asst = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const asstTool = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolRes = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });

const HOOK_FEEDBACK =
  'Stop hook feedback:\nAuto-continue is ON (iteration 3/100). The user is away. ' +
  'When you genuinely have nothing left to do, make the very last line exactly:\n\n' +
  'AUTO_CONTINUE: DONE\n\n…and the next stop will be honored.';
const COMPACT_SUMMARY =
  'This session is being continued from a previous conversation that ran out of context. ' +
  'Summary:\nThe agent was told to emit AUTO_CONTINUE: DONE when finished.';

function check(name, got, want) {
  try {
    assert.strictEqual(got, want);
    pass++; console.log(`  ok   ${name}`);
  } catch (e) {
    fail++; console.log(`  FAIL ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  }
}

console.log('marker detection:');

// F1 — genuine: last assistant turn IS the marker, alone.
check('F1 genuine marker alone',
  ac.extractCompletion(jl([user('do the thing'), asst('AUTO_CONTINUE: DONE')])).markerEmitted, true);

// F2 — genuine: marker is the final line after real work narration.
check('F2 genuine marker as final line',
  ac.extractCompletion(jl([
    asst('Fixed the bug. 68/68 tests pass (exit 0).\n\nAUTO_CONTINUE: DONE')
  ])).markerEmitted, true);

// F3 — hook feedback (user role) quotes the marker; newest assistant has none.
check('F3 hook-feedback quote ignored',
  ac.extractCompletion(jl([
    asst('working on it'), user(HOOK_FEEDBACK), asstTool()
  ])).markerEmitted, false);

// F4 — post-compact summary (user role) quotes the marker; assistant has none.
check('F4 compact-summary quote ignored',
  ac.extractCompletion(jl([
    user(COMPACT_SUMMARY), asst('Resuming. Still working.')
  ])).markerEmitted, false);

// F5 — assistant merely discusses the marker mid-sentence (not a standalone line).
check('F5 inline mention not a stop',
  ac.extractCompletion(jl([
    asst('I will NOT print AUTO_CONTINUE: DONE yet because the build is red.')
  ])).markerEmitted, false);

// F6 — an OLD assistant turn had the marker, but the LAST one does not.
check('F6 only last assistant turn counts',
  ac.extractCompletion(jl([
    asst('done early\nAUTO_CONTINUE: DONE'),
    user(HOOK_FEEDBACK),
    asst('actually more work appeared, continuing')
  ])).markerEmitted, false);

// F7 — marker buried in a tool_result (user role) — never a stop.
check('F7 tool_result quote ignored',
  ac.extractCompletion(jl([
    asst('let me grep'), toolRes('match: AUTO_CONTINUE: DONE in auto-continue.js'), asstTool()
  ])).markerEmitted, false);

// F8 — CRLF line endings around the marker still detected.
check('F8 CRLF marker detected',
  ac.extractCompletion(jl([asst('all green\r\nAUTO_CONTINUE: DONE\r\n')])).markerEmitted, true);

console.log('clean-tail reconstruction:');

// Hook-feedback / compact noise must be stripped from what the verifier sees.
const ct = ac.extractCompletion(jl([
  user('original task: build X'),
  user(HOOK_FEEDBACK),
  asst('made progress, 3 commits'),
  user(COMPACT_SUMMARY),
  asst('AUTO_CONTINUE: DONE')
])).cleanTail;
check('cleanTail excludes hook feedback', /Stop hook feedback:/.test(ct), false);
check('cleanTail excludes compact summary', /session is being continued/.test(ct), false);
check('cleanTail keeps real work', /made progress, 3 commits/.test(ct), true);

console.log('verifier lock (recursion guard):');

const LOCK = ac.LOCK;
try { fs.unlinkSync(LOCK); } catch (e) {}
check('no lock → not in flight', ac.verifierInFlight(), false);
fs.writeFileSync(LOCK, `${process.pid}|${Date.now()}`);
check('fresh lock → in flight', ac.verifierInFlight(), true);
// Backdate the lock past LOCK_MAX_AGE_MS (180s) → treated stale & removed.
const old = Date.now() - 10 * 60 * 1000;
fs.utimesSync(LOCK, new Date(old), new Date(old));
check('stale lock → not in flight', ac.verifierInFlight(), false);
check('stale lock auto-removed', fs.existsSync(LOCK), false);

console.log('real overnight transcripts (regression sanity):');

const REAL = [
  'C:\\Users\\Yana\\.claude\\projects\\C--Users-Yana\\52d88cee-a563-4861-b55e-052e765c254a.jsonl',
  'C:\\Users\\Yana\\.claude\\projects\\C--Users-Yana\\b3b1eaa7-a125-40bd-b859-06c7d26e5e86.jsonl',
];
for (const f of REAL) {
  if (!fs.existsSync(f)) { console.log(`  skip (absent) ${path.basename(f)}`); continue; }
  const r = ac.extractCompletion(f);
  const base = path.basename(f).slice(0, 8);
  check(`${base}: no crash, boolean marker`, typeof r.markerEmitted, 'boolean');
  check(`${base}: cleanTail strips hook feedback`, /Stop hook feedback:/.test(r.cleanTail), false);
  check(`${base}: cleanTail non-empty`, r.cleanTail.length > 0, true);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
