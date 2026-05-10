#!/usr/bin/env node
// Session-context hint hook (SessionStart, no matcher — fires on every
// session start, including resume and compact).
//
// Pairs with the optional `.planning/CURRENT.md` workflow described in
// CLAUDE.md. If the user adopts that pattern, this hook surfaces the
// relevant CURRENT.md at session start so the model reads project
// state before answering the first turn.
//
// Logic:
//   - cwd inside <projects-root>/<X>/...  → hint about CURRENT.md in <X>
//   - cwd elsewhere (home, etc.)          → list active projects that
//                                           have CURRENT.md, sorted by
//                                           recency
//   - No matching CURRENT.md              → silent exit (no noise)
//
// Configure the projects root with the CLAUDE_PROJECTS_ROOT env var.
// Default: ~/Projects. Examples:
//   CLAUDE_PROJECTS_ROOT=C:/Projects        (Windows, common convention)
//   CLAUDE_PROJECTS_ROOT=$HOME/code         (Linux/macOS, common convention)
//   CLAUDE_PROJECTS_ROOT=$HOME/dev
//
// If you don't use the CURRENT.md workflow, leave this hook out of
// settings.json — it only adds value paired with that pattern.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECTS_ROOT = (process.env.CLAUDE_PROJECTS_ROOT || path.join(os.homedir(), 'Projects')).replace(/\\/g, '/');
const STDIN_TIMEOUT_MS = 5000;
const MAX_LISTED = 20;

let input = '';
const timer = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const data = JSON.parse(input || '{}');
    const cwd = (data.cwd || process.cwd()).replace(/\\/g, '/');

    let message = '';

    // Case 1: cwd is inside the projects root → hint about that project
    if (cwd.toLowerCase().startsWith(PROJECTS_ROOT.toLowerCase() + '/')) {
      const rel = cwd.slice(PROJECTS_ROOT.length + 1);
      const projectName = rel.split('/')[0];
      const projectRoot = path.join(PROJECTS_ROOT, projectName);
      const currentMd = path
        .join(projectRoot, '.planning', 'CURRENT.md')
        .replace(/\\/g, '/');

      if (fs.existsSync(currentMd)) {
        message =
          `PROJECT CONTEXT: cwd is ${projectRoot.replace(/\\/g, '/')}/. ` +
          `Read this file FIRST with the Read tool before any substantive work:\n\n` +
          `  ${currentMd}\n\n` +
          `It has where the previous session stopped, current open files, and the next concrete step. ` +
          `Saves re-discovering state from git log + grep.`;
      } else {
        message =
          `PROJECT CONTEXT: cwd is ${projectRoot.replace(/\\/g, '/')}/, but \`.planning/CURRENT.md\` does not exist yet. ` +
          `If you do work that should survive into the next session, create it (template in CLAUDE.md). ` +
          `Skip if this is a one-off read-only visit.`;
      }
    }
    // Case 2: cwd is elsewhere → list active projects with CURRENT.md
    else if (fs.existsSync(PROJECTS_ROOT)) {
      let active = [];
      try {
        active = fs
          .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((name) => {
            const cm = path.join(PROJECTS_ROOT, name, '.planning', 'CURRENT.md');
            return fs.existsSync(cm);
          })
          .map((name) => {
            const cm = path.join(PROJECTS_ROOT, name, '.planning', 'CURRENT.md');
            const mtime = fs.statSync(cm).mtimeMs;
            return { name, mtime };
          })
          .sort((a, b) => b.mtime - a.mtime);
      } catch {
        // unreadable projects root — silent exit below
      }

      if (active.length) {
        const list = active
          .slice(0, MAX_LISTED)
          .map((p) => `  - ${PROJECTS_ROOT}/${p.name}/.planning/CURRENT.md`)
          .join('\n');
        message =
          `ACTIVE PROJECTS WITH .planning/CURRENT.md (sorted by recency):\n${list}\n\n` +
          `If the user mentions any of these projects, read that project's CURRENT.md FIRST before answering — ` +
          `it has the previous session's state, open files, and next step.`;
      }
    }

    if (!message) process.exit(0);

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: message,
        },
      }),
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
