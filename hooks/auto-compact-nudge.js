#!/usr/bin/env node
// Auto-compact nudge — PostToolUse hook
// Two-tier early warning so Claude can land on its feet before built-in
// auto-compact fires (~16.5% native remaining on a 200K Opus window).
//
// Tier 1 (PREP, 35% remaining ≈ 78% displayed, ~37K tokens headroom):
//   "wrap up atomic step, write a prep snapshot with working memory"
// Tier 2 (CRITICAL, 26% remaining ≈ 85% displayed, ~19K tokens headroom):
//   "next tool call MUST be the snapshot write, auto-compact imminent"
//
// Each tier fires once per "high usage window". When remaining climbs
// back above RESET_THRESHOLD (e.g. after a compact), both markers clear
// so the cycle can repeat.
//
// Reads metrics written by context-statusline.js to
// os.tmpdir()/claude-ctx-{sid}.json. Without that bridge file, this hook
// is a no-op — the statusline must run at least once per session first.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREP_THRESHOLD = 35;     // fire Tier 1 when remaining <= 35%
const CRITICAL_THRESHOLD = 26; // fire Tier 2 when remaining <= 26%
const RESET_THRESHOLD = 60;    // after compact, if remaining climbs >60% → re-arm
const STALE_SECONDS = 60;

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;
    if (!sessionId) process.exit(0);

    const tmpDir = os.tmpdir();
    const metricsPath = path.join(tmpDir, `claude-ctx-${sessionId}.json`);
    if (!fs.existsSync(metricsPath)) process.exit(0);

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) process.exit(0);

    const remaining = metrics.remaining_percentage;
    const usedPct = metrics.used_pct;
    if (typeof remaining !== 'number') process.exit(0);

    const prepMarker = path.join(tmpDir, `claude-ctx-${sessionId}-prep-nudged.json`);
    const critMarker = path.join(tmpDir, `claude-ctx-${sessionId}-critical-nudged.json`);

    // Re-arm after compact brings usage back down
    if (remaining >= RESET_THRESHOLD) {
      try { if (fs.existsSync(prepMarker)) fs.unlinkSync(prepMarker); } catch (e) {}
      try { if (fs.existsSync(critMarker)) fs.unlinkSync(critMarker); } catch (e) {}
      process.exit(0);
    }

    const snapshotDir = path.join(os.homedir(), '.claude', 'snapshots');
    const prepSnapshotPath = path.join(snapshotDir, `pre-compact-prep-${sessionId}.md`);

    let message = null;

    // Tier 2 first — if we're already in critical zone, skip the prep message.
    if (remaining <= CRITICAL_THRESHOLD && !fs.existsSync(critMarker)) {
      fs.writeFileSync(critMarker, JSON.stringify({ firedAt: now, usedPct }));
      // Also mark prep as "fired" so we don't spam it after critical.
      if (!fs.existsSync(prepMarker)) {
        fs.writeFileSync(prepMarker, JSON.stringify({ firedAt: now, usedPct, skippedToCritical: true }));
      }
      message =
        `CONTEXT CRITICAL (Stage 2/2): usage at ${usedPct}% — only ~19K tokens left before built-in auto-compact fires. ` +
        `Your NEXT tool call MUST be Write to:\n\n` +
        `  ${prepSnapshotPath}\n\n` +
        `Minimum content: (1) active task in one line, (2) next concrete step, (3) files currently open/edited, ` +
        `(4) any in-memory decisions not yet on disk. Skip nice formatting — survival mode. ` +
        `After the snapshot write, finish only the current atomic operation, then stop. ` +
        `SessionStart(compact) hook will restore from this path after compaction.`;
    } else if (remaining <= PREP_THRESHOLD && !fs.existsSync(prepMarker)) {
      fs.writeFileSync(prepMarker, JSON.stringify({ firedAt: now, usedPct }));
      message =
        `CONTEXT CHECKPOINT (Stage 1/2): usage at ${usedPct}% — ~37K tokens until built-in auto-compact. ` +
        `Plan the next ~5-8 tool calls carefully:\n\n` +
        `  1. Finish current atomic step (commit, complete the edit in hand)\n` +
        `  2. Write a prep snapshot to: ${prepSnapshotPath}\n` +
        `     Include: what you're working on, files in flight + their state, the NEXT concrete step, ` +
        `in-memory decisions/constraints not yet persisted.\n` +
        `  3. Don't start NEW multi-step work.\n\n` +
        `Post-compact SessionStart hook will read that snapshot and restore your working memory. ` +
        `A second warning fires at ~19K tokens if you haven't snapshotted by then.`;
    }

    if (!message) process.exit(0);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message
      }
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.exit(0);
  }
});
