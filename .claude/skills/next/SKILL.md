---
name: next
description: Identify and start the next step in the Grade Stack build. Use when the user says "next", "what's next", "start the next step/phase", or wants to continue the build without naming a specific phase. Reads the plan, locates the current position, verifies it against real repo state, then kicks off the next sub-phase or task.
version: 0.1.0
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

## Guardrails
- **One sub-phase at a time.** If the current sub-phase is incomplete, the next step is finishing *it*, not starting the following one.
- If a single sub-phase has many tasks, start the next unchecked task within it rather than restarting the whole sub-phase.
- If the next step is large or ambiguous, lay out the tasks and a branch name and confirm scope before writing code.
- When a step finishes, suggest running `/save` to update progress, and check the box in the plan.
- Creating and switching to the sub-phase's **local** branch is expected and fine. But don't auto-commit, push, or create the GitHub remote unless the step's acceptance criteria call for it and the user agrees.
