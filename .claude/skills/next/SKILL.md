---
name: next
description: Identify and start the next step in the Grade Stack build. Use when the user says "next", "what's next", "start the next step/phase", or wants to continue the build without naming a specific phase. Reads the plan, locates the current position, verifies it against real repo state, then kicks off the next sub-phase or task.
version: 0.2.0
---

# next

Figure out where the Grade Stack build actually is, then start the next step.

The build is a runbook of ordered, lettered sub-phases (Pre-flight, 0, 1A, 1B, 1C, 2A, …). The user wants to keep moving without restating context every time. This skill resolves "what's next" and begins it.

## Source of truth

Read these every run — do not work from memory or a stale summary:

- `docs/PRD-Grade-Stack-v2.md` — *what* and the acceptance contract.
- `docs/PLAN-Grade-Stack-v2.md` — *how* and *in what order*. The checkboxes here are the progress ledger.
- `CLAUDE.md` (project, if present) and `~/.claude/CLAUDE.md` — global rules.

Ignore `v1` files and `docs/internal/` (internal strategy, never committed).

## Procedure

### 1. Locate the current position
- Scan `docs/PLAN-Grade-Stack-v2.md` top-to-bottom for the **first unchecked `- [ ]`** within the **earliest sub-phase that is not fully checked**. That sub-phase is the candidate "current" increment.
- Note the sub-phase's **branch name**, **task list**, and **acceptance criteria** block.

### 2. Verify against reality — do not trust checkboxes blindly
Checkboxes can lag or run ahead of the actual repo. Before declaring the next step, confirm:
- Does the work the *prior* checked items claim actually exist on disk / in git? Spot-check the files, commands, or artifacts they reference (e.g. `content/cycle-XX/`, CI workflow, hooks, the `reliability` CLI).
- Is the repo even initialized? Early on, `git init` and the pre-flight items may be pending — check `git rev-parse --is-inside-work-tree` and the pre-flight list before assuming Phase 0 has started.
- If the ledger and reality disagree, **surface the discrepancy to the user and propose correcting the checkboxes** rather than silently picking a step.

### 3. Announce the next step
State concisely:
- Which sub-phase and which concrete task(s) come next.
- The proposed **branch name** (from the plan; one sub-phase per branch).
- The relevant **acceptance criteria** that define "done" for this increment.

### 4. Create the branch
One sub-phase per branch — work happens on that branch, never directly on the default branch.
- Skip this step if the repo isn't a git repo yet (pre-flight `git init` hasn't run). Branch creation belongs *after* init.
- Determine the sub-phase's branch name from the plan (the `**Branch:**` line).
- If already on that branch, continue. Otherwise create it from the up-to-date default branch:
  - `git switch -c <branch>` if it doesn't exist, or `git switch <branch>` if it does.
  - Branch from a clean tree — if there are unstaged changes that belong to a *different* sub-phase, surface that to the user before switching rather than carrying them across.
- State the branch you landed on before writing any code.

### 5. Start it
Follow the plan's own kickoff convention — implement **only** the current sub-phase, pull no scope forward, and **stop at its acceptance criteria**. Honor the project conventions:
- **Bun** only (no npm/yarn/pnpm); **TypeScript** `strict`; **Commander** CLI; **promptfoo**, **OpenTelemetry**, **MCP** per the stack table.
- Enforce "must never" rules with a hook/schema/CI gate, never a prose instruction.
- Record any stack deviation as an ADR in `docs/decisions/`.

### 6. Open the pull request — always, one PR per sub-phase
Every sub-phase ships as its own PR against the default branch. This step is **not optional** and does **not** wait to be asked. Run it once the sub-phase's acceptance criteria are all met and the local gate is green (`bun run typecheck && bun run check && bun run test && bun run build`):

1. **Update the ledger first** so the PR contains it: check the sub-phase's acceptance boxes in `docs/PLAN-Grade-Stack-v2.md` (with a one-line evidence note each), and record any ADRs/findings.
2. **Commit** all the work using the project commit convention — **standard message, no AI-tool attribution** (see `~/.claude/CLAUDE.md` and `/push`).
3. **Push** and set upstream: `git push -u origin <branch>`.
4. **Open the PR** with `gh`:
   - `gh pr create --base <default-branch> --head <branch> --title "<sub-phase>: <summary>" --body "<body>"`.
   - The body carries the **acceptance-criteria checklist** (checked, one line of evidence each), a short summary of what shipped, and links to any ADRs or notable findings.
5. **Idempotent:** if a PR already exists for the branch (`gh pr list --head <branch>`), push the new commits to it instead of opening a duplicate.
6. If the work realistically spans multiple `next` invocations, open the PR as a **draft** (`--draft`) as soon as the branch has its first pushed commit, then mark it ready (`gh pr ready`) when the acceptance criteria are met — so a PR always exists for an in-flight sub-phase.

After opening, report the PR URL and that CI is running. **Do not merge it.**

## Guardrails
- **One sub-phase at a time.** If the current sub-phase is incomplete, the next step is finishing *it*, not starting the following one.
- If a single sub-phase has many tasks, start the next unchecked task within it rather than restarting the whole sub-phase.
- If the next step is large or ambiguous, lay out the tasks and a branch name and confirm scope before writing code.
- When a sub-phase finishes, check its boxes in the plan and run `/save` (or the equivalent ledger update) **before** the commit, so the PR includes the progress update.
- Creating/switching the sub-phase's **local** branch, committing, pushing, and **opening the PR (step 6)** are all part of the normal flow — do them without waiting to be asked.
- **But never, without the user's explicit go-ahead:** merge the PR, force-push, or create/delete/rename the GitHub remote repo itself. Merge readiness is decided by the CI/eval gates and the user — this skill only opens the PR.
