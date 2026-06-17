# Cycle 04 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**The cheapest reliability upgrade for a mid-market AI agent isn't a bigger model.
It's giving the agent a shape.** This cycle I shipped that shape — the
**Planner → Executor → Validator** pattern — and the before/after number is the
kind I don't usually get to show.

The naive agent was a single model call with a hopeful prompt: "respond with only
a JSON object." Against Claude on Bedrock it scored **0 out of 12** on my eval
suite — not because it was dumb, but because it wrapped good JSON in Markdown
fences the prompt told it not to use. Same agent, restructured into three named
jobs:

- **Planner** — decides the approach and shapes the prompt around the schema; on a
  retry, folds the validator's complaints back in.
- **Executor** — makes exactly one model call.
- **Validator** — extracts the result and **enforces a schema**, rejecting
  anything that doesn't conform.

Same model, same prompt content. **0/12 → 11/12.** The two-point gap to a perfect
score is now a real, *visible* classification edge case — not 12 silent
formatting failures. (The deterministic baseline the CI gate runs against held at
12/12 through the whole refactor, so I know the gain came from the pattern, not
from moving the goalposts.)

Three things make this the mid-market default, not just my default:

**The contract is code, not a prompt.** The validator parses against a Zod schema
and *refuses* non-conforming output. "Structured output" means a parser that says
no — not a sentence asking the model to behave. If the output's wrong, the agent
re-plans with the specific reasons and tries again, up to an enforced turn bound
so it can never spin forever.

**It's legible.** Three named responsibilities and one schema beat a 300-line
prompt nobody on a 5-person team can reason about. You can point at the box that
failed.

**It composes.** The same schema already feeds the eval contract; the same single
model seam will sit behind the gateway in a later phase; the turn bound is the
runaway-loop guard I built two cycles ago. Nothing here is throwaway.

The reusable blueprint and the worked example (support-email triage) are in the
repo. If you're standing up an agent without an ML-platform team behind you, this
is the shape I'd start from.

Next cycle: an MCP integration layer — and the tool-vs-resource mistake almost
every team makes.
