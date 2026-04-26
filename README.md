# claude-config-template

A starter `~/.claude/` config for Claude Code with:

- **Anti-degradation defaults** — `effortLevel: "high"`, max thinking
  tokens, no adaptive thinking — to keep model quality up.
- **Two-stage auto-compact survival** — early-warning hooks and a
  snapshot/restore pair so you don't lose your working memory when
  context auto-compacts.
- **Generic statusline** — model, directory, and a colored context-usage
  bar (turns red and blinks at 80%+).
- **A `CLAUDE.md` template** — global rules with seven concrete
  anti-degradation principles, plus optional sections you can
  uncomment for GSD, gstack, ralph-loop, or aggressive auto-commit.

No secrets, no transcripts, no project-specific personal config — fork
or copy and adjust to taste.

---

## What's inside

```
.
├── CLAUDE.md                          # global rules — copy to ~/.claude/CLAUDE.md
├── settings.json                      # config + hook wiring — copy to ~/.claude/settings.json
├── hooks/
│   ├── auto-compact-nudge.js          # PostToolUse: 2-stage warning before auto-compact
│   ├── pre-compact-snapshot.js        # PreCompact: dumps git + transcript tail
│   ├── post-compact-restore.js        # SessionStart(compact): tells the model to read the snapshot
│   └── context-statusline.js          # statusline + bridge file consumed by auto-compact-nudge
├── .gitignore
└── README.md
```

The four hooks are independent of any plugin (no GSD, gstack, or
ralph-loop dependencies). They use only Node's built-in modules
(`fs`, `path`, `os`, `child_process`).

---

## Requirements

- **Claude Code** installed and working.
- **Node.js** on `PATH` (for the hooks).
- **Anthropic plan that supports `effortLevel: "high"`** — if your plan
  only allows `medium`, drop the `effortLevel` field from
  `settings.json` (the rest still works).

---

## Install

> **Backup first.** If you already have a `~/.claude/CLAUDE.md` or
> `~/.claude/settings.json`, copy them aside before overwriting.

### 1. Copy the files into `~/.claude/`

**macOS / Linux / Git Bash on Windows:**

```bash
cp CLAUDE.md     ~/.claude/CLAUDE.md
cp settings.json ~/.claude/settings.json
mkdir -p ~/.claude/hooks
cp hooks/*.js    ~/.claude/hooks/
chmod +x         ~/.claude/hooks/*.js
```

**PowerShell (Windows):**

```powershell
$claude = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force -Path "$claude\hooks" | Out-Null
Copy-Item CLAUDE.md     "$claude\CLAUDE.md"     -Force
Copy-Item settings.json "$claude\settings.json" -Force
Copy-Item hooks\*.js    "$claude\hooks\"        -Force
```

### 2. Substitute `<CLAUDE_HOME>` in `settings.json`

The hook commands in `settings.json` reference `<CLAUDE_HOME>` as a
placeholder — Claude Code does not expand `~` in hook command strings,
so the path must be absolute. Replace it with your real `~/.claude`
path:

**macOS / Linux:**

```bash
sed -i.bak "s|<CLAUDE_HOME>|$HOME/.claude|g" ~/.claude/settings.json
rm ~/.claude/settings.json.bak
```

**Git Bash on Windows:**

```bash
HOME_FWD=$(cygpath -m "$HOME")   # forward-slash form, e.g. C:/Users/you
sed -i "s|<CLAUDE_HOME>|$HOME_FWD/.claude|g" ~/.claude/settings.json
```

**PowerShell:**

```powershell
$path = "$env:USERPROFILE\.claude" -replace '\\', '/'
(Get-Content "$env:USERPROFILE\.claude\settings.json") `
  -replace '<CLAUDE_HOME>', $path `
  | Set-Content "$env:USERPROFILE\.claude\settings.json"
```

### 3. Verify

Start a new Claude Code session and check:

- The statusline shows `Claude │ <dirname> │ ░░░░░░░░░░ 0%` (it grows
  as context fills).
- After a few tool calls, `os.tmpdir()/claude-ctx-<session-id>.json`
  exists — that's the bridge file the nudge hook reads.

If something is wrong, look at `~/.claude/debug/` for hook errors.

---

## Customize

### `CLAUDE.md`

Open it and skim the seven anti-degradation rules — adjust language,
remove what doesn't fit your workflow. Optional sections at the bottom
(GSD, gstack, ralph-loop, aggressive auto-commit) are commented out;
uncomment whichever apply to you.

### `settings.json`

Things you may want to change:

- **`effortLevel`** — `"high"` is the recommended ceiling. Drop or
  lower it if your plan doesn't support it.
- **`theme`** — `"dark"` / `"light"` / etc.
- **`MAX_THINKING_TOKENS`** — `128000` is generous; lower it if you
  want to save tokens.
- **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`** — keeps you on the standard
  ~200K window. The 1M-token beta is available, but empirically the
  model degrades noticeably on it (loses long-range coherence, gets
  sloppy with file paths). Remove only if you really need >200K and
  accept the quality drop.
- **`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`** — forces full thinking
  budget on every turn instead of letting the system shrink it
  adaptively. Pairs with `MAX_THINKING_TOKENS=128000`.

### Recommended companion plugins / skills (optional)

This template intentionally ships only the four custom hooks. The
plugins and skill packs below pair well with the anti-degradation
defaults — install whichever you want, **independently** from this
template. Each is maintained by its own author and stays fresh on its
own release cycle.

> Why not bundle them? Bundling third-party code freezes it at the
> version I happened to copy and creates licence/attribution
> ambiguity. A pointer keeps you on the upstream.

#### GSD (Get Shit Done) — spec-driven workflow with sub-agents

A meta-prompting / context-engineering system. Adds 80+ `/gsd:*`
slash commands (planner, executor, debugger, verifier, etc.) and
runs heavy work in fresh 200K sub-agent contexts so your main
session stays lean.

- Source: <https://github.com/gsd-build/get-shit-done>
- Author: TÂCHES (Lex Christopherson / glittercowboy)
- Install: see the project README — current versions auto-detect
  Claude Code's skills directory.

If you install GSD, uncomment the **`## GSD`** block at the bottom
of `CLAUDE.md`.

#### gstack — Garry Tan's skill pack

Browser-driven QA, design review, eng review, security review,
release tooling. The `/browse` skill is a fast headless-browser
replacement for `mcp__claude-in-chrome__*`.

- Source: <https://github.com/garrytan/gstack>
- Author: Garry Tan (Y Combinator)
- License: MIT
- Install: follow the project README (one-paste install).

If you install gstack, uncomment the **`## gstack`** block at the
bottom of `CLAUDE.md`.

#### ralph-loop — continuous-work plugin

Runs a `/ralph-loop:ralph-loop` command that loops Claude on a
target until a stop condition fires. From the official Anthropic
plugin marketplace.

- Source: <https://github.com/anthropics/claude-plugins-official>
- Install (inside Claude Code):
  ```
  /plugin install ralph-loop@claude-plugins-official
  ```

If you install it, uncomment the **`## ralph-loop`** block in
`CLAUDE.md`.

#### chrome-cdp — direct Chrome DevTools Protocol skill

Talk to a running Chrome (or AdsPower / Dolphin / AgentX profile)
over CDP without the Playwright MCP overhead. Useful for browser
automation when you want full control of the session.

- Upstream: <https://github.com/pasky/chrome-cdp-skill>
- Fork with AgentX support: <https://github.com/cryptoyasenka/chrome-cdp-skill>
- Install: clone somewhere, then symlink into `~/.claude/skills/`:
  ```bash
  git clone https://github.com/pasky/chrome-cdp-skill.git
  ln -s "$PWD/chrome-cdp-skill/skills/chrome-cdp" ~/.claude/skills/chrome-cdp
  ```

---

### Sound notifications (optional)

Add hooks that play a system sound when Claude finishes a turn or asks
for input. Append to the `hooks` block in `settings.json`:

**Windows (PowerShell sounds):**

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "powershell -NoProfile -WindowStyle Hidden -Command \"[System.Media.SystemSounds]::Asterisk.Play()\"",
    "timeout": 3
  }]
}],
"Notification": [{
  "hooks": [{
    "type": "command",
    "command": "powershell -NoProfile -WindowStyle Hidden -Command \"[System.Media.SystemSounds]::Exclamation.Play()\"",
    "timeout": 3
  }]
}]
```

**macOS:**

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "afplay /System/Library/Sounds/Glass.aiff",
    "timeout": 3
  }]
}],
"Notification": [{
  "hooks": [{
    "type": "command",
    "command": "afplay /System/Library/Sounds/Ping.aiff",
    "timeout": 3
  }]
}]
```

**Linux (PulseAudio / `paplay`):**

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
    "timeout": 3
  }]
}]
```

---

## How the auto-compact survival pair works

Claude Code's built-in auto-compact fires automatically at ~16.5%
native context remaining (≈100% on the displayed bar). When it does,
the model loses its in-flight working memory: open files, decisions
made but not yet on disk, the immediate next step. The hooks in this
config minimize that loss in three steps:

1. **Warning** (`auto-compact-nudge.js`, PostToolUse). At 35%
   remaining ("PREP") it asks Claude to write a snapshot itself —
   Claude knows what's in flight, the hook doesn't. At 26% remaining
   ("CRITICAL") it makes that snapshot the next mandatory tool call.
2. **Hook fallback** (`pre-compact-snapshot.js`, PreCompact). Right
   before built-in auto-compact runs, it dumps `git status`,
   recent commits, and the last 30 transcript entries to
   `~/.claude/snapshots/pre-compact-<session>.md`. This is external
   state only — it can't capture in-memory plans.
3. **Restore** (`post-compact-restore.js`, SessionStart with
   `matcher: "compact"`). After auto-compact, it injects an
   instruction telling Claude to read whichever snapshot exists,
   preferring Claude's own prep snapshot over the automated one.

The bridge file written by `context-statusline.js` is what makes the
nudge possible — it's how the PostToolUse hook learns the current
remaining-percentage, which Claude Code does not pass to that hook
directly.

---

## Backing up your live `~/.claude/`

If you want to keep a sanitized backup of your working `~/.claude/` in
git (not just this template), don't reuse this repo's `.gitignore` —
your live directory contains OAuth tokens (`.credentials.json`), API
keys (`.claude.json`, `.mcp.json`), and full conversation transcripts
(`*.jsonl`). Use a **whitelist** strategy: deny everything, then
explicitly allow safe files. Example:

```gitignore
# Deny everything
/*

!.gitignore
!README.md
!CLAUDE.md
!settings.json
!hooks/
hooks/**/node_modules/
!agents/
!commands/

# Optional: include auto-memory but never sessions
!projects/
projects/*
!projects/*/
projects/*/*
!projects/*/memory/
!projects/*/memory/**

# Belt-and-suspenders: explicit denylist of known-sensitive files
.credentials.json
.claude.json
.mcp.json
settings.local.json
history.jsonl
**/*.jsonl
sessions/
shell-snapshots/
file-history/
todos/
tasks/
telemetry/
session-env/
paste-cache/
cache/
debug/
backups/
plugins/
skills/
```

After applying, run `git status` and verify nothing sensitive is
staged before your first commit.

---

## License

MIT — do whatever you like.
