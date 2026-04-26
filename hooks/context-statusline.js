#!/usr/bin/env node
// Claude Code statusline + context bridge.
//
// Renders:   model | directory | [█████░░░░░ 47%]
//
// Side effect (important): writes context metrics to
// os.tmpdir()/claude-ctx-{session_id}.json so the PostToolUse hook
// auto-compact-nudge.js can read them and warn the model before the
// built-in auto-compact fires. Without this bridge file, the nudge
// hook is a no-op.
//
// The "used %" shown here is normalized: Claude Code reserves ~16.5%
// of the context window for its own auto-compact buffer, so 100%
// displayed = the point at which auto-compact actually triggers.

const fs = require('fs');
const path = require('path');
const os = require('os');

const AUTO_COMPACT_BUFFER_PCT = 16.5;

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    let ctx = '';
    if (remaining != null) {
      const usableRemaining = Math.max(
        0,
        ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100
      );
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

      // Bridge file consumed by auto-compact-nudge.js
      if (session) {
        try {
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
          fs.writeFileSync(bridgePath, JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000),
          }));
        } catch (e) {
          // Best-effort: never break the statusline if the temp dir is unwritable.
        }
      }

      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      if (used < 50) {
        ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      } else if (used < 65) {
        ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      } else if (used < 80) {
        ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      } else {
        ctx = ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
      }
    }

    const dirname = path.basename(dir);
    process.stdout.write(`\x1b[2m${model}\x1b[0m │ \x1b[2m${dirname}\x1b[0m${ctx}`);
  } catch (e) {
    // Silent fail — never break the statusline on parse errors.
  }
});
