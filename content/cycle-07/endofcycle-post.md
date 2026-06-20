# Cycle 07 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**You can prevent failures or you can see them — a production AI agent needs
both.** This cycle I shipped tracing for the reference stack, and the test was
simple: can one run tell you the whole story of what the agent did?

Here's the actual trace from a run, captured with one flag and no dashboard:

```
• agent.run
  • mcp.ground
    • chat <model>            ← the model picks a tool from descriptions
    • execute_tool lookup_account
  • agent.plan
  • agent.execute
    • chat <model>            ← the model drafts the triage
  • agent.validate
```

That's the planner → tool call → validation path as one **connected** trace —
plan, the tool the agent chose, the model calls with their token usage, and the
schema check at the end. When a run goes wrong, you read this instead of guessing.

Three decisions made it fit a mid-market stack, not just a demo:

1. **OpenTelemetry GenAI conventions, so the backend is swappable.** I view traces
   in Phoenix locally by default; the same run points at Braintrust, Jaeger, or
   your existing collector by changing one environment variable. No lock-in.
2. **Off by default, on by one flag.** With tracing off, no tracer is registered —
   the CI eval gate stays deterministic and the air-gapped variant has nothing to
   phone home. Observability that you have to *opt into* is observability that
   can't quietly break your other guarantees.
3. **The scorecard's "Observability" line is no longer a stub.** It's now computed
   from a real captured trace: is the run connected (one trace, one root), and are
   all of plan/execute/validate visible as spans? An executive reads a rating; it
   traces straight down to whether the agent is actually inspectable.

The pattern I keep coming back to: every reliability property in this stack is a
**mechanism, not a memo.** Guardrails the prompt can't switch off. A gate the
baseline enforces. And now traces that are on when you ask and invisible when you
don't — so "we have observability" is something you can see in a span tree, not a
claim in a deck.

Repo + the tracing write-up in the post. Next phase: governance — mapping this
stack to OWASP, NIST, and the EU AI Act.
