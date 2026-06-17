# ADR 0006 — MCP tool-vs-resource control model + name-blind selection over the text seam

- **Status:** Accepted
- **Date:** 2026-06-17
- **Phase:** 2B (MCP integration layer)

## Context

Phase 2B requires an MCP server exposing **at least one tool and one resource**,
"correctly distinguished (model-controlled action vs. app-exposed data)," that
the reference agent **consumes**, with **tool descriptions (not names or prompt
rules) driving selection**, and both **stdio and HTTP transports** documented.

Two design tensions had to be resolved:

1. **Tool vs. resource.** MCP exposes both, and teams routinely collapse the
   distinction — shipping read-only reference data as a "tool" the model calls,
   or hiding an action behind a "resource." The control model is the point: a
   *resource* is application-controlled data the host chooses to put in context;
   a *tool* is a model-controlled action the agent decides to invoke.

2. **How the agent selects tools without breaking the model seam.** ADR 0005
   kept `ModelProvider.generate` deliberately **text-in / text-out** — the seam
   the 2C gateway and 3D air gap depend on — and chose schema-parse over
   provider-native tool-use. Provider-native MCP tool-calling would reintroduce
   exactly the tool-call channel ADR 0005 declined, across providers (the
   deterministic stub, smaller Ollama models) whose support is uneven.

## Decision

**Control model.** The support MCP server (`@grade-stack/mcp-server`) exposes:

- **Resource** `policy://support/triage` — the triage policy (priority rules,
  category routing, SLA targets). Stable, human-authored reference data the
  application supplies. It takes no arguments and performs no action, so it is a
  resource, not a tool.
- **Tools** `lookup_account` and `search_help_articles` — model-controlled
  actions returning live account facts / help-centre hits respectively. The
  agent decides whether and when to call them.

`search_help_articles` is deliberately a *second, plausible* tool so that
description-driven selection is **observable**, not asserted.

**Selection mechanism — name-blind, over the text seam.** The agent does not use
provider-native tool-use. Instead it lists the server's tools and asks the model
to choose via one ordinary `generate` call whose prompt presents each tool by
its **description and argument schema only — never its name** (`buildSelectionPrompt`
in `reference-agent/src/mcp.ts`). The model returns `{ "choice": n, "arguments": … }`;
`parseSelection` maps the index back to the concrete tool name to call. Because
the name is structurally absent from the model's input, selection *cannot* be
driven by the name or by a hard-coded `if billing → lookup_account` rule — only
by the description. The tool call itself goes through the MCP client; the model
call goes through the unchanged `ModelProvider` text seam.

**Transports.** The server is transport-agnostic; `./connect` attaches either
**stdio** (local subprocess — the agent spawns `bun <SERVER_BIN>`) or
**streamable HTTP** (remote, over `Bun.serve`, stateless). Both are exercised by
a real MCP client.

**MCP grounding is opt-in.** `runReferenceAgent({ mcp: true })` /
`RELIABILITY_MCP=1` / `agent run --mcp` enable it; the default is **off**, so the
deterministic stub baseline and the CI eval gate are untouched by 2B.

## Rationale

- **The distinction is defensible per the control model**, and the distractor
  tool makes selection *demonstrable*: with a real model, the billing email
  selects `lookup_account` and a how-to question selects `search_help_articles`
  (`reliability mcp demo`).
- **Name-blind selection is a mechanism, not a hope.** A unit test asserts no
  tool name appears in the selection prompt, and a swap test shows that swapping
  only the two descriptions swaps the selected tool — proving the description,
  not the name, drives the choice.
- **The text seam stays narrow** (consistent with ADR 0005): no provider gains a
  tool-call channel, so 2C credential isolation and the 3D air gap are
  unaffected, and the stub/Ollama paths keep working.

## Consequences

- Tool selection costs one extra bounded model call before planning when MCP is
  enabled; it is reported by the existing token/cost accounting.
- The agent can ground its triage in real account facts (e.g. the duplicate
  charge `INV-20418`/`INV-20419`) instead of inventing them — the grounding is
  fed to the planner as context but never relaxes the schema the validator
  enforces.
- "Tool selection" in this stack means *the model picking from descriptions over
  the text seam*, not provider-native function-calling. A future phase may still
  bind a native tool channel to the same `RemoteTool` description surface.
