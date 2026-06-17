# Cycle 05 — Mid-cycle "what surprised me" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

This cycle I'm adding the integration layer — **MCP**, the Model Context Protocol
— so the agent can reach real systems (an account lookup, a help-centre search)
instead of guessing. And the thing that surprised me is how much of "doing MCP
right" comes down to one question almost nobody asks out loud:

**who's in control — the app, or the model?**

MCP gives you two ways to expose a capability: a **tool** and a **resource**. They
look interchangeable in the SDK, and that's the trap. A *resource* is data the
**application** decides to put in front of the model — reference material, a
policy, a record. A *tool* is an action the **model** decides to invoke. The line
isn't technical; it's about who holds the steering wheel.

I watched myself almost get it backwards. My triage policy — the rules for how to
prioritize and route a support email — felt like something the agent should "go
get." So my first instinct was to make it a tool the model calls. But the policy
isn't an action and the model shouldn't *decide* whether to follow company policy.
It's app-controlled data the application should always supply. That's a resource.
The account lookup — fetching a customer's real billing state — *is* a model
decision (call it only when account state matters). That's a tool.

Get this backwards and you've quietly handed the model control of something the
business should own, or made the app beg the model to use data it could have just
provided. Same protocol, opposite control model.

The other thing I'm being strict about: **descriptions, not names, drive tool
selection.** More on that — and the before/after — at end of cycle.
