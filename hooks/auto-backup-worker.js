#!/usr/bin/env node
// Background worker for the auto-backup Stop hook. Mirrors a whitelisted
// subset of ~/.claude/ into the configured backup clone, then commits
// and pushes any real changes. Idempotent: empty diff -> exits silently.
//
// Configure via env var CLAUDE_BACKUP_REPO (set in settings.json's `env`
// block) — the local path to a private git clone of your backup repo.
//
// Whitelist (everything else is NEVER copied):
//   - CLAUDE.md, settings.json
//   - hooks/, agents/, commands/   (skipping node_modules, *.lock, *.log)
//   - projects/*/memory/           (auto-memory across all project slugs)
//
// Sensitive paths NOT mirrored: .credentials.json, .claude.json, .mcp.json,
// settings.local.json, sessions/*.jsonl, snapshots/, plugins/, skills/,
// debug/, telemetry/, paste-cache/.
//
// Git identity comes from your global git config (user.name/user.email
// in ~/.gitconfig). If git has no global identity, the commit step will
// fail and the failure is logged.
//
// CRLF noise on Windows is neutralized if the backup repo has a
// `.gitattributes` with `* text=auto eol=lf` — strongly recommended.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(os.homedir(), '.claude');
const REPO = process.env.CLAUDE_BACKUP_REPO || '';
const LOG = path.join(SRC, 'hooks', 'auto-backup.log');
const LOCK = REPO ? path.join(REPO, '.git', 'auto-backup.lock') : '';

if (!REPO || !fs.existsSync(path.join(REPO, '.git'))) process.exit(0);

function log(msg) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
    if (fs.statSync(LOG).size > 256 * 1024) {
      const tail = fs.readFileSync(LOG, 'utf8').slice(-128 * 1024);
      fs.writeFileSync(LOG, tail);
    }
  } catch {}
}

function copyFile(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    if (entry.name.endsWith('.log')) continue;
    if (entry.name.endsWith('.lock')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

// Single-flight lock — if another worker is already running, bail out.
try {
  fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
} catch {
  process.exit(0);
}

process.on('exit', () => {
  try { fs.unlinkSync(LOCK); } catch {}
});

try {
  // Top-level whitelisted files
  copyFile(path.join(SRC, 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'));
  copyFile(path.join(SRC, 'settings.json'), path.join(REPO, 'settings.json'));

  // Whitelisted directories (custom logic written by the user)
  copyDir(path.join(SRC, 'hooks'), path.join(REPO, 'hooks'));
  copyDir(path.join(SRC, 'agents'), path.join(REPO, 'agents'));
  copyDir(path.join(SRC, 'commands'), path.join(REPO, 'commands'));

  // Auto-memory: projects/<slug>/memory/ — slug varies per machine
  // (it's keyed off the home directory), so discover dynamically.
  const projectsDir = path.join(SRC, 'projects');
  if (fs.existsSync(projectsDir)) {
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const memorySrc = path.join(projectsDir, entry.name, 'memory');
      if (!fs.existsSync(memorySrc)) continue;
      copyDir(memorySrc, path.join(REPO, 'projects', entry.name, 'memory'));
    }
  }

  git('add -A');

  // Anything actually staged after .gitattributes normalization?
  try {
    git('diff --cached --quiet');
    process.exit(0); // No real changes
  } catch {
    // Non-zero = there are staged changes; proceed.
  }

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  const stat = git('diff --cached --shortstat').trim();
  const msg = `auto: ${stamp} session backup\n\n${stat}`;
  fs.writeFileSync(path.join(REPO, '.git', 'COMMIT_EDITMSG'), msg);
  git('commit -F .git/COMMIT_EDITMSG');

  try {
    git('push origin main', { timeout: 30000 });
    log(`pushed: ${stat}`);
  } catch (e) {
    log(`push failed (will retry next session): ${e.message.split('\n')[0]}`);
  }
} catch (e) {
  log(`error: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
} finally {
  try { fs.unlinkSync(LOCK); } catch {}
}
