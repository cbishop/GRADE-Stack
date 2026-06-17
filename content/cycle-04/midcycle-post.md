# Cycle 04 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

This cycle I'm turning the naive reference agent into a real one: an explicit
**Planner → Executor → Validator** loop. And the thing that surprised me is how
much of "reliability" turned out to be *one design decision* — where the contract
lives.

The naive agent asked the model, in the prompt, to "respond with only a JSON
object." On my local model that worked fine. On Claude via Bedrock it scored
**zero out of twelve** — not because the answers were wrong, but because the model
wrapped its perfectly-good JSON in a Markdown ` ```json ` fence. The prompt said
"only JSON." The model said "sure," and added fences anyway. A prose instruction
binds nobody — not even a language model.

The fix wasn't a better prompt. It was moving the contract out of the prompt and
into **code**: a schema (Zod) that the validator *parses against* and **rejects**
anything that doesn't conform — after stripping the fences the model insists on
adding. Output that doesn't meet the schema doesn't get a pass and a sigh; it gets
rejected, and the planner re-plans with the validator's specific complaints until
it conforms or the turn bound trips.

That's the whole mid-market lesson in miniature. "Structured output" isn't a
prompt that asks nicely — it's a parser that refuses. The schema is the
mechanism; the prompt is just a request. Same principle as every other guardrail
in this stack: if it matters, enforce it with something that can say no.

Shipping the pattern + the numbers at end of cycle.
