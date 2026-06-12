# Cycle 01 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

I wrote a 12-case eval suite for my naive agent this week and it immediately
caught something I would never have seen by eyeballing a demo.

The *exact same* agent — same prompt, same code, temperature 0 — scores **12/12
on a local Llama model and 0/12 on Claude (via Bedrock)**.

The cause is almost funny: Claude wraps its JSON answer in a ```` ```json ````
markdown fence. Llama doesn't. My naive agent does zero output parsing — it just
hands back whatever the model said — so against Claude the "JSON" isn't valid
JSON, and every downstream check fails.

Here's the part worth sitting with: **I did not fix it.** This cycle's job is to
*measure*, not to improve. A naive agent that quietly breaks the moment you swap
models is precisely the "before" state the whole project exists to expose. If
I'd patched it on the spot, I'd have hidden the most useful thing the harness
told me.

That's the cheapest reliability win there is. Not a fancy framework — just a
handful of cases that run on every change and tell you the truth. One run
surfaced a model-portability bug, and it'll surface the next regression too.

The unglamorous lesson: you can't manage what you can't measure, and you can't
measure an agent by watching it succeed once.

Shipping the harness write-up at the end of the cycle. The fix for the fences
comes later — on purpose.
