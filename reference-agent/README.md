# reference-agent

The single, narrow reference task the whole build is measured on:

> **Triage an inbound support email and draft a structured response.**

This Phase 0 version is intentionally **naive** — a direct model call with no
reliability tooling. It is the documented "before" state that evals (1A), the
CI gate (1B), and the scorecard (1C) will measure against. It runs end-to-end
against **both** Bedrock and Ollama via `@grade-stack/core`.
