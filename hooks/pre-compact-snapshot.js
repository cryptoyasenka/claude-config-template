#!/usr/bin/env node
// PreCompact snapshot hook
// Runs BEFORE context compaction (auto or manual). Writes a recovery
// snapshot to ~/.claude/snapshots/pre-compact-{session_id}.md so that the
// SessionStart(matcher=compact) hook can point the post-compact model back
// to the state that existed before the squeeze.
//
// What we save:
//   - timestamp, trigger (auto|manual), cwd, session_id
//   - MEMORY.md index (so the model re-indexes memories after compact)
//   - git status + current branch + last 5 commits (if cwd is a git repo)
//   - last 30 lines of the transcript (best-effort tail of the jsonl)
//
// PreCompact CANNOT inject additionalContext (not supported by the hook
// type) — that's why the companion hook is SessionStart, which CAN.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SNAPSHOT_DIR = path.join(os.homedir(), '.claude', 'snapshots');
const STDIN_TIMEOUT_MS = 10000;
const MAX_SNAPSHOTS = 20;            // cap stored snapshots
const MAX_AGE_DAYS = 7;              // delete anything older than this

function cleanupOldSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return;
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter(f => f.startsWith('pre-compact-') && f.endsWith('.md'))
      .map(f => {
        const full = path.join(SNAPSHOT_DIR, f);
        const stat = fs.statSync(full);
        return { path: full, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (let i = 0; i < files.length; i++) {
      const { path: fp, mtime } = files[i];
      if (i >= MAX_SNAPSHOTS || mtime < cutoff) {
        try { fs.unlinkSync(fp); } catch (e) {}
      }
    }
  } catch (e) {}
}

function safeExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch (e) {
    return '';
  }
}

function tailTranscript(transcriptPath, lines = 30) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    const tail = raw.slice(-lines);
    const summary = [];
    for (const line of tail) {
      try {
        const entry = JSON.parse(line);
        const role = entry.type || entry.role || 'unknown';
        const text = typeof entry.content === 'string'
          ? entry.content
          : (entry.message && typeof entry.message.content === 'string' ? entry.message.content : '');
        if (text) summary.push(`[${role}] ${text.slice(0, 200)}`);
      } catch (e) {}
    }
    return summary.join('\n');
  } catch (e) {
    return '';
  }
}

let input = '';
const timer = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const data = JSON.parse(input || '{}');
    const sessionId = data.session_id || 'unknown';
    const trigger = data.trigger || data.matcher || 'unknown';
    const cwd = data.cwd || process.cwd();
    const transcriptPath = data.transcript_path || '';

    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
    const gitBranch = isGitRepo ? safeExec('git rev-parse --abbrev-ref HEAD', cwd) : '';
    const gitStatus = isGitRepo ? safeExec('git status --short', cwd) : '';
    const gitLog = isGitRepo ? safeExec('git log -5 --oneline', cwd) : '';

    const transcriptTail = tailTranscript(transcriptPath, 30);

    const now = new Date().toISOString();
    const snapshot = `# Pre-Compact Snapshot

**Timestamp:** ${now}
**Trigger:** ${trigger}
**Session:** ${sessionId}
**CWD:** ${cwd}

## Git state
${isGitRepo ? `**Branch:** ${gitBranch}

### Status
\`\`\`
${gitStatus || '(clean)'}
\`\`\`

### Recent commits
\`\`\`
${gitLog}
\`\`\`
` : '(not a git repository)'}

## Transcript tail (last ~30 entries, truncated)
\`\`\`
${transcriptTail || '(unavailable)'}
\`\`\`
`;

    const snapshotPath = path.join(SNAPSHOT_DIR, `pre-compact-${sessionId}.md`);
    fs.writeFileSync(snapshotPath, snapshot, 'utf8');

    const pointerPath = path.join(SNAPSHOT_DIR, 'latest.txt');
    fs.writeFileSync(pointerPath, snapshotPath, 'utf8');

    cleanupOldSnapshots();
    process.exit(0);
  } catch (e) {
    process.exit(0);
  }
});
