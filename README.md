# claude-config-template

A starter `~/.claude/` config for Claude Code with:

- **Anti-degradation defaults** — `effortLevel: "high"`, max thinking
  tokens, no adaptive thinking — to keep model quality up.
- **Two-stage auto-compact survival** — early-warning hooks and a
  snapshot/restore pair so you don't lose your working memory when
  context auto-compacts.
- **Generic statusline** — model, directory, and a colored
  context-usage bar (green → yellow → orange → blinking red with a
  💀 at 80%+).
- **A `CLAUDE.md` template** — global rules with seven concrete
  anti-degradation principles, plus optional sections you can
  uncomment for a per-project working-memory pattern
  (`.planning/CURRENT.md`), GSD, gstack, ralph-loop, or aggressive
  auto-commit.

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
├── .gitattributes                     # forces LF line endings (shebangs need them on macOS/Linux)
├── .gitignore
├── LICENSE                            # MIT
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
- **Extended thinking access** — `MAX_THINKING_TOKENS=128000` and
  `alwaysThinkingEnabled: true` require a plan that exposes the
  extended-thinking budget. Without it those keys are silently ignored;
  no harm, just no benefit. Drop them or lower the value to match your
  plan's ceiling.

---

## Install

> **Backup first.** If you already have a `~/.claude/CLAUDE.md` or
> `~/.claude/settings.json`, copy them aside before overwriting.

### 1. Copy the files into `~/.claude/`

**macOS / Linux / Git Bash on Windows:**

```bash
mkdir -p ~/.claude/hooks
cp CLAUDE.md     ~/.claude/CLAUDE.md
cp settings.json ~/.claude/settings.json
cp hooks/*.js    ~/.claude/hooks/
```

> The hooks are invoked by Claude Code as `node "path/to/hook.js"`
> (see `settings.json`), so the executable bit and the `#!/usr/bin/env node`
> shebang are decorative — no `chmod +x` needed.

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

**PowerShell (Windows PowerShell 5.1 and PowerShell 7+):**

```powershell
$file = "$env:USERPROFILE\.claude\settings.json"
$path = ("$env:USERPROFILE\.claude") -replace '\\', '/'
$utf8 = [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM
$body = [System.IO.File]::ReadAllText($file, $utf8) -replace '<CLAUDE_HOME>', $path
[System.IO.File]::WriteAllText($file, $body, $utf8)
```

> Why `[System.IO.File]` instead of `Set-Content`? Windows PowerShell 5.1's
> `Set-Content` writes in the system default encoding (ANSI on most
> Windows installs), which corrupts the JSON if your `$USERPROFILE`
> contains non-ASCII characters. `[System.IO.File]` writes UTF-8 without
> a BOM on both 5.1 and 7+ regardless of locale.

### 3. Verify

Start a new Claude Code session and check:

- The statusline shows `Claude │ <dirname> │ ░░░░░░░░░░ 0%` (it grows
  as context fills, going green → yellow → orange → blinking red with
  a 💀 as the bar approaches 100%).
- After a few tool calls, a bridge file `claude-ctx-<session-id>.json`
  appears in your system temp directory. The nudge hook reads it to
  decide when to warn you about the upcoming auto-compact:
  - **Windows:** `%TEMP%\claude-ctx-<sid>.json`
    (typically `C:\Users\<you>\AppData\Local\Temp\`)
  - **macOS:** `$TMPDIR/claude-ctx-<sid>.json`
    (typically `/var/folders/.../T/`)
  - **Linux:** `/tmp/claude-ctx-<sid>.json`

If something is wrong, look at `~/.claude/debug/` for hook errors.

---

## Customize

### `CLAUDE.md`

Open it and skim the seven anti-degradation rules — adjust language,
remove what doesn't fit your workflow. Optional sections at the bottom
are commented out; uncomment whichever apply to you:

- **Per-project working memory (`.planning/CURRENT.md`)** — a
  workflow pattern, not a tool install. Keep one short file per repo
  with current status, open files, and the next concrete step. Survives
  auto-compact, session crashes, and power loss because it lives in
  the repo rather than in conversation context. Pairs naturally with
  the auto-compact survival hooks shipped here. Adopt it if you switch
  between several projects, or if your environment is unreliable
  (laptop with bad battery, region with power outages); skip it for
  one-off scripts.
- **GSD, gstack, ralph-loop** — third-party plugin/skill packs.
  Uncomment the matching block only if you've installed the tool.
- **Aggressive auto-commit** — overrides the default "don't commit
  unless asked". Use it if losing in-flight work is costly in your
  setup.

### `settings.json`

> **Cost trade-off — read this before you copy.** The thinking-related
> defaults here (`alwaysThinkingEnabled: true` +
> `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` + `MAX_THINKING_TOKENS=128000`)
> are tuned for **hard engineering work** — multi-file refactors,
> debugging, architecture, anything where you'd rather Claude take
> 60 seconds and get it right than 5 seconds and confidently miss the
> bug. The thinking-token spend is justified there.
>
> The downside: every turn — including trivial ones like *"open this
> file"* or *"what does this command do"* — also walks up to the
> 128K thinking ceiling. On a small Anthropic plan, or in a workflow
> dominated by short Q&A and quick lookups, this preset will feel
> expensive. If that's you, drop `alwaysThinkingEnabled` (and
> optionally `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`) and let the model
> scale its thinking budget adaptively — you keep the quality ceiling
> for hard turns and skip the burn on easy ones.

Things you may want to change:

- **`effortLevel`** — `"high"` is the recommended ceiling. Drop or
  lower it if your plan doesn't support it.
- **`alwaysThinkingEnabled`** — when `true`, every turn enters extended
  thinking, even trivial ones. Set to `false` (or remove) if you do a
  lot of short Q&A; you keep `effortLevel: "high"` for hard turns and
  skip the thinking budget on easy ones.
- **`theme`** — `"dark"` / `"light"` / etc.
- **`MAX_THINKING_TOKENS`** — `128000` is the ceiling, not the spend
  per turn. With adaptive thinking enabled the model usually uses
  far less; with adaptive thinking disabled (default below) it walks
  closer to the ceiling on every turn. Lower it if you want a hard cap.
- **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`** — keeps you on the standard
  ~200K window. The 1M-token beta is available, but empirically the
  model degrades noticeably on it (loses long-range coherence, gets
  sloppy with file paths). Remove only if you really need >200K and
  accept the quality drop.
- **`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`** — forces the full
  `MAX_THINKING_TOKENS` budget on every turn instead of letting the
  system shrink it for easy questions. Pair with
  `alwaysThinkingEnabled: true` for maximum quality at maximum cost;
  remove both for a cheaper "think only when it actually helps" mode.

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
