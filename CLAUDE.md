# Personal Claude Code rules

This file is loaded into every Claude Code session as global instructions
(`~/.claude/CLAUDE.md`). The rules below override Claude's defaults.

Edit freely. Add project-specific rules in each repo's own `CLAUDE.md` or
`.claude/CLAUDE.md` — those layer on top of this one.

---

# Anti-degradation rules

Apply these on every turn. Each rule has a number so you can refer back to
it ("violated rule 3, redo") in conversation.

**1. Verify before claiming done.** Before reporting a task complete, run
the actual check: unit tests, linter, type-checker, or a manual smoke
test in the browser. Don't rely on "should work". If no automatic
verification exists for a change, say so explicitly: *"I cannot verify
this automatically — please test manually."*

**2. Define scope before coding.** For any feature larger than ~1 hour
of work, write down the boundaries and the "done" criteria first
(in chat, in a `.planning/*.md` draft, or by asking the user). Don't
start typing code with fuzzy requirements.

**3. Read before writing.** For non-trivial changes, read the relevant
existing code, docs, or spec first. Sketch a short plan in chat or in
a project-local `.planning/*.md` file. Do NOT use the auto-memory index
(`MEMORY.md`) as a scratchpad — it gets truncated past ~200 lines.

**4. Secrets and ports.** Never hardcode keys, tokens, or passwords —
use environment variables and `.env` files (which must be in
`.gitignore`). Never bind to `0.0.0.0` when `127.0.0.1` is enough.
Before shipping a public deployment, audit secrets and exposed ports.

**5. Real research for fast-moving APIs.** For libraries that change
frequently (AI SDKs, web frameworks, blockchain SDKs, recently-released
tools), use `WebSearch` or `WebFetch` to read current docs before
writing code. Training data is months stale — don't trust it for these.

**6. Don't roll back the anti-degradation settings.** The global settings
in `~/.claude/settings.json` — `effortLevel: "high"`,
`alwaysThinkingEnabled: true`, `MAX_THINKING_TOKENS=128000`,
`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`,
`CLAUDE_CODE_DISABLE_1M_CONTEXT=1` — exist to keep model quality high.
If you (or a previous session) downgraded `effortLevel` to `medium`/`low`
or removed those env vars, flag it and propose restoring `high`.

**7. Read-to-Edit ratio as a health check.** If you feel like you're
making mistakes, count the last ~20 tool calls: how many `Read` vs
`Edit/Write`? A healthy ratio is ≥6:1 (investigate first, then
modify). If it's ≤3:1 (editing without reading), that's a degradation
signal — stop, re-read context, and consider `/compact` or `/clear`.

---

# Auto-compact behavior (two-stage warning)

The Opus context window is ~200K tokens (with `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`).
Claude Code's built-in auto-compact fires automatically at ~16.5%
native remaining (≈100% on the displayed bar). Your job is **not** to
call `/compact` manually, but to save your **working memory** to a
snapshot file BEFORE auto-compact wipes it. The hook can dump git state
and a transcript tail; only you know your current plan, in-flight files,
and unwritten decisions.

The `auto-compact-nudge.js` PostToolUse hook injects warnings in two
stages:

**Stage 1 — PREP (35% remaining ≈ 78% displayed, ~37K tokens of
headroom).** When you see this message:
1. Finish the current atomic step (commit, complete the edit in hand).
2. Use **Write** to save a detailed snapshot to
   `~/.claude/snapshots/pre-compact-prep-{session_id}.md`. Include:
   what you're working on, files in flight + their state, the next
   concrete step, and any in-memory decisions/constraints not yet on
   disk.
3. Don't start NEW multi-step work.
4. Continue normally — built-in auto-compact will fire on its own,
   and the post-compact hook will restore you from the snapshot.

**Stage 2 — CRITICAL (26% remaining ≈ 85% displayed, ~19K tokens
headroom).** Last chance if you skipped Stage 1:
1. Your **next tool call MUST** be `Write` to the same prep snapshot
   path.
2. Minimum content: active task + next step + open files. Skip nice
   formatting — survival mode.
3. After the snapshot write, finish the current atomic operation and
   keep working. Do **not** treat the warning as a stop signal —
   built-in auto-compact will fire on its own, and the post-compact
   hook restores from the snapshot. Stop only if the user's task is
   actually done or genuinely blocked.

**Exception for destructive operations** (DB migration, `git rebase`,
deploy, multi-step loop iteration): take the work to the nearest
checkpoint (commit / safe rollback point) first, then snapshot.

**Re-arm:** both stage markers reset when remaining climbs back >60%
(after a successful auto-compact). No repeated nudging within the same
"high usage wave".

**After auto-compact:** the `SessionStart(matcher=compact)` hook
injects an instruction telling you to read the prep snapshot. Priority
order: hand-written prep snapshot first, automated PreCompact snapshot
as fallback.

**Manual `/compact`:** only run it if you genuinely feel context is
clogged with garbage *before* Stage 1 fires. Even then, write the prep
snapshot first — manual compact wipes working memory exactly like the
automatic one.

**Diagnostic when nothing was restored:** check
`~/.claude/snapshots/pre-compact-prep-{sid}.md`. No file → both nudges
were ignored. File present but not read after compact → the
`SessionStart(compact)` hook isn't firing — check `settings.json`.

---

# Commit discipline

Default: **don't commit unless asked.** Override this if your project
or environment justifies it (see optional block below).

- Before any commit, run `git status` and `git diff --staged` to make
  sure no junk slipped in.
- Stage specific files by name; avoid `git add -A` / `git add .` so
  `.env`, credentials, and large binaries don't sneak in.
- Never commit secrets even in WIP. If something secret got staged,
  `git restore --staged <file>` and warn the user.
- Never use `--no-verify`, `--no-gpg-sign`, or amend a published
  commit unless explicitly asked.

<!--
OPTIONAL: Aggressive auto-commit mode.
Uncomment this block if you work in an environment where losing in-flight
work is costly (laptops with bad batteries, regions with power outages,
unreliable disks). It overrides the default "don't commit unless asked".

# Aggressive auto-commit (override default)

In any git project, commit **frequently and on your own initiative** —
don't wait for an explicit request each time. This overrides the default
"do not commit without permission" rule. Treat permission as already
granted.

- **After each meaningful chunk:** test passed, function finished, bug
  fixed → immediately `git add` the relevant files + `git commit`.
  Don't accumulate 10 changes into one commit.
- **In long sessions** (autonomous loops, multi-phase execution waves):
  commit between steps even if work isn't done — a WIP commit beats
  lost work.
- **Unfinished code** is also committed, with a `wip:` prefix in the
  message. Squash later if needed.
- **Push to origin** after every *green* (non-WIP) commit. A local
  commit doesn't help if the disk dies. WIP can be pushed to a feature
  branch but not main.
- **If not a git repo** (folder with no `.git`) — don't init it
  yourself, just warn: "this directory isn't a git repo, in-flight
  work is at risk — should I init?"
-->

---

# Optional sections

Uncomment any of the blocks below if you've installed the corresponding
tooling, or if you want to adopt the workflow pattern it describes.
Keeping them out of the default keeps this file portable.

<!--
## Per-project working memory — `.planning/CURRENT.md`

A lightweight pattern that survives auto-compact, session crashes, and
unreliable power. The conversation context can be lost; this file lives
in the repo and survives. Treat it as the source of truth for
"where am I right now" — distinct from longer-form spec/plan files,
which describe "what to do long-term".

In each active project, keep a `.planning/CURRENT.md` file. Target
~40-100 lines total, organised like this:

- **Header (two `**bold:**` lines, no section heading):**
  `**Last touched:** YYYY-MM-DD HH:MM` and
  `**Status:** <one-line elevator pitch>` — e.g.
  `Status: in PHASE-3, task 4/7`. The one-liner is for the reader who
  just wants to know "where am I" at a glance.
- `## Status` — checklist breakdown: what's done, in flight, blocked.
  This expands the one-liner above.
- `## Open files` — paths and line numbers you're editing right now
- `## Next step` — one concrete next action (not a vague goal — not
  "finish the UI" but "add retry logic at client.py:42 after the
  connect-test passes")
- `## Decisions / constraints` — agreements made in the session that
  aren't yet on disk

(The duplicated "Status" — once as a header line, once as a heading —
is intentional. They serve different readers: a glance vs. a scan.)

When to update (prefer `Edit` over `Write` — atomic):
- After every meaningful step: a commit, a finished component, a
  fixed bug → update `Status` and `Next step`
- When the active file set changes → update `Open files`
- Before ending a session, or just before writing a pre-compact prep
  snapshot → final update
- When marking the task "complete" → final update with status
  `complete`

When to read:
- At the very start of a session in that project — **first**, before
  any other action
- After auto-compact — the pre-compact prep snapshot should point at
  this file; read it before resuming
- Whenever you feel lost about which file to touch next — re-read
  before the next step

For new projects, create `CURRENT.md` among the **first** files
(alongside README), not as a deferred task. A minimal initial body is
enough: `Status: "just initialized"`, `Next step: "<first thing>"`,
`Last touched: <date>`. Skip this only for one-off scripts or
read-only forks.

How it interacts with other tools:
- **Spec/phase files** (e.g. GSD `.planning/PHASE-*.md`): they describe
  what to build; `CURRENT.md` describes the in-flight position. If a
  phase file is active, `CURRENT.md` references it, e.g.
  `Status: in PHASE-3, task 4/7`.
- **Pre-compact prep snapshots**: instead of trying to fit all working
  memory into the snapshot, write a short pointer ("working in
  ~/code/X, read .planning/CURRENT.md there, plus 2-3 lines of
  session-only context that isn't in CURRENT.md yet"). Source of truth
  is `CURRENT.md` in the repo.

Template to drop into a new project's `.planning/CURRENT.md`:

```
# CURRENT — <project name>

**Last touched:** YYYY-MM-DD HH:MM
**Status:** <one line>

## Status
- [x] <done>
- [ ] <in progress>
- [ ] <next>

## Open files
- `path/to/file.py:LL` — what I'm editing
- ...

## Next step
<concrete action, not abstract goal>

## Decisions / constraints
- <what we agreed in this session that isn't in code yet>
```
-->

<!--
## GSD (Get Shit Done) — github.com/gsd-build/get-shit-done

Spec-driven workflow with 80+ /gsd:* slash commands and fresh-context
sub-agents. Install per the project README.

Common commands: /gsd:new-project, /gsd:plan-phase,
/gsd:execute-phase, /gsd:debug, /gsd:verify-work, /gsd:next.

Workflow rules (apply when GSD is installed):
- Before a feature larger than ~1 hour: /gsd:discuss-phase to lock
  scope and "done" criteria.
- For non-trivial debugging: /gsd:debug (scientific-method session
  with checkpoints).
- Use /gsd:verify-work, not "looks good", to confirm features built.
- The GSD plugin installs its own ~/.claude/hooks/gsd-*.js. They use
  different event types (PreToolUse, Stop) than the auto-compact hooks
  shipped here (PostToolUse, PreCompact, SessionStart) so they should
  not conflict — but verify by running with both enabled and watching
  ~/.claude/debug/ for errors.
-->

<!--
## gstack — github.com/garrytan/gstack

Use the /browse skill for all web browsing. Never use
mcp__claude-in-chrome__* tools.

Common skills: /office-hours, /plan-ceo-review, /plan-eng-review,
/plan-design-review, /design-consultation, /design-shotgun,
/design-html, /review, /ship, /land-and-deploy, /canary, /benchmark,
/browse, /qa, /qa-only, /design-review, /retro, /investigate,
/document-release, /codex, /cso, /autoplan, /devex-review,
/careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn.
-->

<!--
## ralph-loop — anthropics/claude-plugins-official marketplace

Install once: /plugin install ralph-loop@claude-plugins-official
Use /ralph-loop:ralph-loop in a repo to start a continuous work loop
with a stop hook. /ralph-loop:cancel-ralph to stop.
-->
