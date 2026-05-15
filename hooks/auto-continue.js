#!/usr/bin/env node
// Stop hook: auto-continue overnight runs.
// Blocks Stop and tells Claude to keep working — only when ALL guards pass.
//
// Activate by writing flag file: ~/.claude/auto-continue.flag
//   - empty file or "*"        → active for ANY session
//   - file contains session_id → active only for that session
// Deactivate: delete the flag, or Claude ends an assistant turn whose final
// line is exactly "AUTO_CONTINUE: DONE" AND an independent verifier ratifies it.
//
// Marker detection is ROLE-AWARE: we parse the JSONL transcript and look at the
// LAST assistant message only. A raw byte-scan is wrong because the literal
// "AUTO_CONTINUE: DONE" also appears in (a) this hook's own injected feedback
// (a user-role turn), (b) post-compact summary turns, (c) tool results, (d)
// Claude merely discussing the protocol. Only Claude's own assistant turn,
// with the marker as a standalone final line, is a legitimate stop request.
//
// Safety guards (any one of them ends auto-continue cleanly):
//   1. MAX_ITERATIONS hard cap per session (counter at ~/.claude/auto-continue-{sid}.count)
//   2. Context floor — if remaining_percentage < CONTEXT_FLOOR, let auto-compact run
//   3. Verified done-marker — last assistant turn ends with the marker AND the
//      independent verifier ratifies it → flag removed
//   4. User can rm the flag any time
//
// Returns {decision:"block", reason:"..."} to keep Claude going. Exit 0 to allow stop.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLAG = path.join(os.homedir(), '.claude', 'auto-continue.flag');
const CONFIG = path.join(os.homedir(), '.claude', 'auto-continue.json'); // {model, condition}
const LOCK = path.join(os.homedir(), '.claude', '.ac-verifier.lock');    // verifier-in-flight sentinel
const COUNTER_DIR = path.join(os.homedir(), '.claude');
const LOG_PATH = path.join(os.homedir(), '.claude', 'auto-continue.log');

const MAX_ITERATIONS = 100;     // hard cap per session
const CONTEXT_FLOOR = 22;       // remaining% — below this, let built-in auto-compact run
const DONE_MARKER = 'AUTO_CONTINUE: DONE';
// Marker is legit ONLY as a standalone line (its own line, optional surrounding
// horizontal whitespace). Rejects "do NOT print AUTO_CONTINUE: DONE yet" prose.
const MARKER_LINE_RE = /(^|\n)[ \t]*AUTO_CONTINUE: DONE[ \t]*(\r?\n|$)/;
const LOCK_MAX_AGE_MS = 180000; // Sonnet verifier (120s) + generous overhead
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) {}
}

// Remove flag + verifier config + this session's iteration counter.
function clearState(sid) {
  try { fs.unlinkSync(FLAG); } catch (e) {}
  try { fs.unlinkSync(CONFIG); } catch (e) {}
  try { fs.unlinkSync(path.join(COUNTER_DIR, `auto-continue-${sid}.count`)); } catch (e) {}
}

// Verifier config written by ac-on. Missing/broken → safe defaults
// (Haiku, generic judgement) so the legacy "just create the flag" flow keeps working.
function loadConfig() {
  try {
    // PowerShell 5.1 writes UTF-8 *with BOM*; strip it before parsing.
    const j = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^﻿/, ''));
    const model = (j.model === 'sonnet' || j.model === SONNET) ? SONNET
                : (!j.model || j.model === 'haiku' || j.model === HAIKU) ? HAIKU
                : String(j.model);
    return { model, condition: typeof j.condition === 'string' ? j.condition.trim() : '' };
  } catch (e) {
    return { model: HAIKU, condition: '' };
  }
}

function claudeBin() {
  const local = path.join(os.homedir(), '.local', 'bin',
    process.platform === 'win32' ? 'claude.exe' : 'claude');
  try { if (fs.existsSync(local)) return local; } catch (e) {}
  return 'claude';
}

// Read up to `bytes` from the END of a (possibly huge) JSONL transcript and
// return whole lines. The first sliced line is almost always truncated, so we
// drop it. Returns [] on any error (caller treats as "no marker").
function readTailLines(transcriptPath, bytes) {
  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(stat.size, bytes);
    const fd = fs.openSync(transcriptPath, 'r');
    const bufr = Buffer.alloc(readSize);
    fs.readSync(fd, bufr, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const lines = bufr.toString('utf8').split('\n');
    if (stat.size > readSize && lines.length) lines.shift(); // drop partial head line
    return lines.filter(l => l.trim());
  } catch (e) {
    return [];
  }
}

// Pull the text out of a transcript row's message.content (string or block[]).
function rowText(row) {
  const msg = row && row.message;
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text).join('\n');
  }
  return '';
}

// Noise we never want the verifier to judge on: this hook's own injected
// feedback, and the post-compact summary blob. Both are user-role turns that
// quote the protocol verbatim — exactly the false-positive sources.
function isNoiseUserText(t) {
  return /^\s*Stop hook feedback:/.test(t)
      || /Auto-continue is ON \(iteration/.test(t)
      || /This session is being continued from a previous conversation/.test(t);
}

// Role-aware completion check + clean transcript reconstruction for the verifier.
// Returns { markerEmitted: bool, cleanTail: string }.
//   markerEmitted → the LAST assistant turn ends with the standalone marker line
//   cleanTail     → last ~12 real assistant/user text turns (noise stripped),
//                    chronological, capped ~16KB — fed to the verifier instead
//                    of raw JSONL so it judges on actual work, not framing.
function extractCompletion(transcriptPath) {
  const lines = readTailLines(transcriptPath, 1024 * 1024); // 1MB tail
  const rows = [];
  for (const l of lines) {
    try { rows.push(JSON.parse(l)); } catch (e) { /* skip truncated/garbage */ }
  }

  let markerEmitted = false;
  let sawAssistant = false;
  const turns = []; // newest-first, then reversed

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const type = r && r.type;
    const role = r && r.message && r.message.role;
    const text = rowText(r).trim();

    if (type === 'assistant' && role === 'assistant') {
      // Only the *last* assistant turn's marker is a legitimate stop request.
      if (!sawAssistant && text && MARKER_LINE_RE.test(text)) markerEmitted = true;
      sawAssistant = true;
      if (text && turns.length < 12) turns.push(`ASSISTANT: ${text}`);
    } else if ((type === 'user' || role === 'user') && text && !isNoiseUserText(text)) {
      if (turns.length < 12) turns.push(`USER: ${text}`);
    }
    if (turns.length >= 12) break;
  }

  let cleanTail = turns.reverse().join('\n\n---\n\n');
  if (cleanTail.length > 16 * 1024) cleanTail = cleanTail.slice(-16 * 1024);
  return { markerEmitted, cleanTail };
}

// True if a verifier spawn is already in flight (fresh lock). Stale locks
// (crashed spawn) are removed so they can't wedge the system permanently.
function verifierInFlight() {
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < LOCK_MAX_AGE_MS) return true;
    try { fs.unlinkSync(LOCK); } catch (e) {} // stale → clear
  } catch (e) { /* no lock */ }
  return false;
}

// Independent ratification of the DONE marker — the /goal idea, bounded by
// our own hard guards. Returns { ok: true|false|null, reason }.
//   true  → marker legit, allow stop
//   false → premature/unproven, keep working (reason fed back to Claude)
//   null  → verifier unavailable → caller falls back to trusting the marker
function runVerifier(tailText, cfg) {
  const { execFileSync } = require('child_process');
  const timeoutMs = cfg.model === SONNET ? 120000 : 60000;
  const task = cfg.condition
    ? `The user defined this explicit completion condition:\n<condition>\n${cfg.condition}\n</condition>`
    : `No explicit condition was set. Judge generically whether the work is genuinely finished.`;
  const prompt =
`You are an INDEPENDENT completion auditor for an unattended overnight coding agent.
The agent just emitted "${DONE_MARKER}", claiming it should stop. Decide if that is legitimate.

${task}

Rules:
- Judge ONLY from evidence visible in the transcript excerpt below. You cannot run anything.
- Treat unverified claims as NOT done. "Tests pass" with no shown test output / exit code = NOT done.
- Stopping is legitimate ONLY if (a) the condition (or, if none, the obvious task) is demonstrably complete WITH evidence in the transcript, OR (b) the agent is genuinely blocked on a human decision, credential, or external system it cannot proceed without.
- A natural pause point, partial progress, "good place to stop", or an unproven success claim is NOT legitimate.
- When unsure, prefer CONTINUE.

Respond with EXACTLY two lines:
VERDICT: DONE   (or)   VERDICT: CONTINUE
REASON: <one concrete sentence, max 30 words>

--- TRANSCRIPT EXCERPT (tail) ---
${tailText}
--- END EXCERPT ---`;
  try {
    // Belt-and-suspenders recursion guard (alongside AC_EVAL env): a fresh lock
    // tells any concurrently-firing hook that a verifier is already running, so
    // it must NOT spawn another. Fail direction = "keep working", never a fork bomb.
    try { fs.writeFileSync(LOCK, `${process.pid}|${Date.now()}`); } catch (e) {}
    try {
      const out = execFileSync(claudeBin(),
        ['-p', '--model', cfg.model, '--max-turns', '1', '--output-format', 'text'], {
          input: prompt,
          timeout: timeoutMs,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: Object.assign({}, process.env, { AC_EVAL: '1' })
        });
      const v = /VERDICT:\s*(DONE|CONTINUE)/i.exec(out || '');
      if (!v) return { ok: null, reason: 'no VERDICT line in verifier output' };
      const r = /REASON:\s*(.+)/i.exec(out || '');
      const isDone = v[1].toUpperCase() === 'DONE';
      const reason = r ? r[1].trim().slice(0, 240)
                       : (isDone ? 'condition met' : 'work not yet complete');
      return { ok: isDone, reason };
    } finally {
      try { fs.unlinkSync(LOCK); } catch (e) {}
    }
  } catch (e) {
    return { ok: null, reason: `verifier spawn/timeout: ${String((e && e.message) || e).slice(0, 160)}` };
  }
}

function main() {
let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 8000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    // Recursion guard (primary): the verifier spawns a headless `claude`, whose
    // own Stop event re-enters this script. AC_EVAL=1 is set in that child's env
    // so it bails immediately instead of spawning verifiers forever. The
    // filesystem lock below is the secondary guard if env propagation ever fails.
    if (process.env.AC_EVAL === '1') process.exit(0);

    if (!fs.existsSync(FLAG)) process.exit(0);

    const data = JSON.parse((input || '{}').replace(/^﻿/, ''));
    const sessionId = data.session_id || 'unknown';
    const transcriptPath = data.transcript_path;
    const stopHookActive = data.stop_hook_active;

    // Critical: if stop_hook_active is true, this Stop event was triggered
    // BY a previous Stop-hook block. Don't loop infinitely on our own block —
    // honor the natural end of turn.
    if (stopHookActive) {
      log(`session=${sessionId} stop_hook_active=true → exit (avoid recursion)`);
      process.exit(0);
    }

    // Read flag — empty or "*" means any session, otherwise must match
    let flagContent = '';
    try { flagContent = fs.readFileSync(FLAG, 'utf8').trim(); } catch (e) {}
    if (flagContent && flagContent !== '*' && flagContent !== sessionId) {
      log(`session=${sessionId} flag bound to ${flagContent} → skip`);
      process.exit(0);
    }

    // Done-marker check. The marker is a *request* to stop, not a command: an
    // independent verifier model must ratify it (closes the self-report hole).
    // Detection is role-aware (last assistant turn only) so the verifier runs
    // ONLY on a genuine completion — a normal continue turn pays zero cost.
    let verifierMsg = '';
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      try {
        const { markerEmitted, cleanTail } = extractCompletion(transcriptPath);
        if (markerEmitted && verifierInFlight()) {
          // A verifier is already running (AC_EVAL env likely didn't propagate,
          // or a concurrent session). Do NOT spawn another — fall through to
          // the normal continue path. Safe direction: keep working, no fork bomb.
          log(`session=${sessionId} marker seen but verifier already in flight → skip verify, continue`);
        } else if (markerEmitted) {
          const cfg = loadConfig();
          const v = runVerifier(cleanTail, cfg);
          if (v.ok === null) {
            // Verifier unavailable → FAIL SAFE to the pre-existing behaviour:
            // trust the marker. Never make the safety system more dangerous
            // just because the new optional component is down.
            log(`session=${sessionId} DONE marker, verifier UNAVAILABLE (${v.reason}) → fallback trust marker, allow stop`);
            clearState(sessionId);
            process.exit(0);
          }
          if (v.ok === true) {
            log(`session=${sessionId} DONE marker RATIFIED by ${cfg.model}: ${v.reason} → allow stop`);
            clearState(sessionId);
            process.exit(0);
          }
          // v.ok === false → rejected; keep working, feed the reason to Claude.
          verifierMsg = v.reason;
          log(`session=${sessionId} DONE marker REJECTED by ${cfg.model}: ${v.reason} → keep working`);
        }
      } catch (e) {
        log(`session=${sessionId} transcript read error: ${e.message}`);
      }
    }

    // Context-floor check — bridge file from gsd-statusline.js
    const tmpDir = os.tmpdir();
    const metricsPath = path.join(tmpDir, `claude-ctx-${sessionId}.json`);
    if (fs.existsSync(metricsPath)) {
      try {
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        const remaining = metrics.remaining_percentage;
        if (typeof remaining === 'number' && remaining < CONTEXT_FLOOR) {
          log(`session=${sessionId} remaining=${remaining}% < floor=${CONTEXT_FLOOR}% → let auto-compact run`);
          process.exit(0);
        }
      } catch (e) {}
    }

    // Iteration counter
    const counterPath = path.join(COUNTER_DIR, `auto-continue-${sessionId}.count`);
    let count = 0;
    try {
      if (fs.existsSync(counterPath)) count = parseInt(fs.readFileSync(counterPath, 'utf8'), 10) || 0;
    } catch (e) {}
    if (count >= MAX_ITERATIONS) {
      log(`session=${sessionId} count=${count} >= max=${MAX_ITERATIONS} → cap reached, removing flag`);
      clearState(sessionId);
      const output = {
        decision: 'block',
        reason: `Auto-continue safety cap reached (${MAX_ITERATIONS} iterations). Flag removed. ` +
                `If you genuinely have more work, summarize current state and ask the user before continuing.`
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    fs.writeFileSync(counterPath, String(count + 1));
    log(`session=${sessionId} continue iteration=${count + 1}/${MAX_ITERATIONS}`);

    const verifierPrefix = verifierMsg
      ? `⚠ Your "${DONE_MARKER}" was REJECTED by the independent verifier: ${verifierMsg}\n` +
        `Do NOT emit the marker again until that specific gap is closed AND the proof ` +
        `(test output, exit code, diff, etc.) is visible in your own output.\n\n`
      : '';
    const reason =
      verifierPrefix +
      `Auto-continue is ON (iteration ${count + 1}/${MAX_ITERATIONS}). ` +
      `The user is away (overnight run). DO NOT stop and wait for input. ` +
      `Continue making progress on the user's task autonomously:\n\n` +
      `  • If working on a GSD phase: keep executing the plan.\n` +
      `  • If a project has .planning/CURRENT.md: read its "Next step" and do that.\n` +
      `  • If a step is unclear: pick the most reasonable interpretation and proceed, ` +
      `documenting the decision in CURRENT.md or a commit message.\n` +
      `  • Commit work in atomic chunks (per CLAUDE.md autocommit rule) to survive power cuts.\n\n` +
      `When you genuinely have nothing left to do (task complete, or blocked waiting on a real ` +
      `human decision/credential/external system), make the VERY LAST line of your final ` +
      `message exactly this, alone on its own line, nothing after it:\n\n` +
      `${DONE_MARKER}\n\n` +
      `An independent verifier then checks the transcript; it only honors the stop if the work ` +
      `is provably complete (test output / exit codes / diffs visible in your own messages) or ` +
      `you are truly blocked. Do NOT emit it just because a step felt like a natural pause.`;

    const output = { decision: 'block', reason };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    log(`error: ${e.message}`);
    process.exit(0);
  }
});
}

if (require.main === module) {
  main();
} else {
  // Test surface — pure logic only, no stdin/exit side effects on require.
  module.exports = {
    extractCompletion, verifierInFlight, loadConfig,
    isNoiseUserText, rowText, MARKER_LINE_RE, LOCK
  };
}
