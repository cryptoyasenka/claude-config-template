#!/usr/bin/env node
// Stop hook entry point for the auto-backup pair. Spawns the worker as a
// detached background process and returns immediately so the user's turn
// is never delayed by the backup.
//
// The worker mirrors a whitelisted subset of ~/.claude/ (CLAUDE.md,
// settings.json, hooks/, agents/, commands/, projects/*/memory/) into
// a separate git clone, commits any real changes, and pushes them.
//
// Configure with the CLAUDE_BACKUP_REPO env var pointing at the local
// path of a private git clone. Without it (or without a `.git` directory
// at that path), this hook silently no-ops — safe to leave wired up.
//
// Kill switch: create the file `~/.claude/.no-auto-backup` to disable
// without editing settings.json. Remove it to re-enable.
//
// See README for full setup, the whitelist, and diagnostics.

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.CLAUDE_BACKUP_REPO || '';
const WORKER = path.join(__dirname, 'auto-backup-worker.js');
const KILL_SWITCH = path.join(os.homedir(), '.claude', '.no-auto-backup');

if (existsSync(KILL_SWITCH)) process.exit(0);
if (!REPO || !existsSync(path.join(REPO, '.git'))) process.exit(0);
if (!existsSync(WORKER)) process.exit(0);

try {
  const child = spawn(process.execPath, [WORKER], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
} catch {
  // Never block the user's response on a backup failure.
}

process.exit(0);
