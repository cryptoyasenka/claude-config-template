#!/usr/bin/env node
// Post-compact restore hook (SessionStart, matcher=compact)
// Fires when Claude Code starts a session that is a continuation after
// auto or manual compaction. Injects additionalContext pointing the model
// at the pre-compact snapshot so it can restore its working memory.
//
// Priority order for the snapshot to restore from:
//   1. pre-compact-prep-{sid}.md   — Claude's own self-written snapshot
//                                    (richer: contains working memory,
//                                    plan, decisions, next steps)
//   2. pre-compact-{sid}.md         — automated PreCompact hook snapshot
//                                    (fallback: MEMORY index, git, transcript tail)
//   3. latest.txt pointer           — whichever snapshot was written last
//
// Companion to pre-compact-snapshot.js and auto-compact-nudge.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SNAPSHOT_DIR = path.join(os.homedir(), '.claude', 'snapshots');
const STDIN_TIMEOUT_MS = 5000;

let input = '';
const timer = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const data = JSON.parse(input || '{}');
    if (data.source !== 'compact') process.exit(0);

    const sessionId = data.session_id || '';

    // Priority 1: Claude's self-written prep snapshot (has working memory)
    const prepPath = path.join(SNAPSHOT_DIR, `pre-compact-prep-${sessionId}.md`);
    // Priority 2: automated PreCompact snapshot (has external state)
    const autoPath = path.join(SNAPSHOT_DIR, `pre-compact-${sessionId}.md`);
    // Priority 3: latest.txt pointer (any recent snapshot)
    const pointerPath = path.join(SNAPSHOT_DIR, 'latest.txt');

    let snapshotPath = null;
    let snapshotKind = null;

    if (fs.existsSync(prepPath)) {
      snapshotPath = prepPath;
      snapshotKind = 'prep (Claude-written, includes working memory)';
    } else if (fs.existsSync(autoPath)) {
      snapshotPath = autoPath;
      snapshotKind = 'auto (hook-generated: git state + transcript tail)';
    } else if (fs.existsSync(pointerPath)) {
      const fallback = fs.readFileSync(pointerPath, 'utf8').trim();
      if (fallback && fs.existsSync(fallback)) {
        snapshotPath = fallback;
        snapshotKind = 'fallback (latest.txt pointer)';
      }
    }

    if (!snapshotPath) process.exit(0);

    const extraNote = fs.existsSync(prepPath) && fs.existsSync(autoPath)
      ? `\n\nNOTE: an auto-generated snapshot also exists at ${autoPath} — read it too ` +
        `if the prep snapshot is missing git/transcript context you need.`
      : '';

    const message =
      `POST-COMPACT RESTORE: context was just compacted. Snapshot to restore from:\n\n` +
      `  ${snapshotPath}\n  (${snapshotKind})\n\n` +
      `Read this file NOW with the Read tool before answering the next user turn. ` +
      `Do not answer substantive questions until you have read it — you have likely forgotten ` +
      `file paths, in-progress edits, decisions, and constraints that were in context before.${extraNote}`;

    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: message
      }
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});
