# ADR 0005 — Validator structured output via Zod schema-parse, not native tool-use

- **Status:** Accepted
- **Date:** 2026-06-17
- **Phase:** 2A (Planner / Executor / Validator pattern)

## Context

Phase 2A requires the validator to use **structured output** — "tool-use /
schema-enforced via Zod→tool-schema, **not** prompted JSON. This is an
enforcement mechanism — the schema is the contract." The verification step is
explicit: *"validator output rejects a schema-violating response."*

The literal reading — "tool-use" — would have the model emit the result through
a provider-native tool/function-call with a JSON-Schema-constrained argument.
But the stack's single model seam, `ModelProvider.generate` (Phase 0,
`@grade-stack/core`), is deliberately **text-in / text-out**. It is the seam the
2C gateway and 3D air gap depend on; every provider (Bedrock, Ollama, the stub)
implements exactly it. Adding a native tool-call channel would mean:

- widening `GenerateRequest`/`GenerateResult` with a tool-schema + tool-result
  shape across **every** provider, including ones (Ollama models, the
  deterministic stub) whose tool-use support is uneven or nonexistent; and
- doing that widening in 2A, ahead of the 2B MCP work where tool-use actually
  belongs — i.e. pulling scope forward, which the plan forbids.

The Phase 1A finding also lands here: Claude on Bedrock fences JSON in
` ```json … ``` `, which scored Bedrock **0/12**; "output extraction lands in
Phase 2A."

## Decision

Make the **Zod schema the contract** and enforce it with a **parse**, keeping the
text seam intact:

- The validator is built from a Zod schema (`zodValidator(TriageSchema)` in
  `@grade-stack/core`). Its `jsonSchema` field is the schema **projected to JSON
  Schema** via `z.toJSONSchema` — this is the "Zod→tool-schema" projection, and
  it is handed to the planner so the executor is *told* the exact contract.
- Enforcement is `schema.safeParse(...)` on the model's output, **after** robust
  extraction (`extractJsonObject` strips Markdown fences and falls back to the
  first `{ … }` span — the deferred 1A fix). Non-conforming output is **rejected**
  and fed back to the planner as repair instructions; the loop re-plans up to the
  enforced turn bound.

Correctness therefore depends on **code that rejects** (the parse), not on the
prompt asking nicely — which is the actual distinction "not prompted JSON" draws.

## Rationale

- **The mechanism is real, not prose.** A schema-violating response cannot pass:
  `safeParse` fails, the case is rejected, and the bound caps the retries. That
  satisfies the verification line directly.
- **The text seam stays narrow.** No provider gains a tool-call channel it can't
  honour; the stub and Ollama paths keep working unchanged; 2C/3D are unaffected.
- **It fixes the 1A regression** in the same stroke: extraction takes Bedrock
  from 0/12 to 11/12 (see PLAN 2A notes), so eval scores *improve* through the
  refactor rather than merely holding.
- **It does not foreclose native tool-use.** If a later phase (e.g. 2B MCP, or a
  provider that supports constrained decoding) wants a native tool channel, the
  `Validator` interface and its `jsonSchema` are already the contract to bind to.

## Consequences

- The model can still *emit* malformed text; the guarantee is that malformed text
  never **passes** — it is rejected and retried within the bound, and a run that
  never conforms throws `MaxTurnsError` rather than returning junk.
- The JSON Schema is now part of the prompt (larger input token count). At this
  scale the cost is negligible and is reported by the existing cost-per-success
  metric.
- "Structured output" in this stack means *schema-enforced parse*, not
  provider-native function-calling. Documented here so the choice reads as
  deliberate, not as an oversight.
