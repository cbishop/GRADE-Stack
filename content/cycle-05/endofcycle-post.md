# Cycle 05 — End-of-cycle "shipped" post

> Draft for public posting (LinkedIn narrative). Review before publishing.

---

**The tool-vs-resource mistake almost every team makes with MCP isn't a bug —
it's a control-model error, and it's invisible until something goes wrong.** This
cycle I shipped the MCP integration layer for the reference agent, and the whole
design hinges on one distinction most tutorials skip.

MCP lets you expose a capability two ways:

- A **resource** is data the **application** chooses to put in context. It's not
  an action. Here: `policy://support/triage` — the triage policy (priority rules,
  routing, SLA targets). The app always supplies it; the model doesn't get to
  decide whether to "follow company policy."
- A **tool** is an action the **model** chooses to invoke. Here: `lookup_account`
  (fetch a customer's real billing state) and `search_help_articles`. The agent
  decides *whether* and *when*.

Flip those two and you've made a quiet, expensive mistake: either the model now
controls data the business should own, or your app is begging the model to use
information it could have just handed over. Same SDK calls, opposite control
model. The fix is to ask one question of every capability — *is this an action
the model should decide to take, or data the app should supply?* — and let the
answer pick tool or resource.

The second thing I got strict about: **tool descriptions — not names, not prompt
rules — drive selection.** Plenty of agents "work" because someone wrote `if the
email is about billing, call lookup_account` into the prompt. That's not the model
choosing a tool; that's you hard-coding a router and taking credit. So I made the
agent **name-blind**: when it picks a tool, it sees each tool's *description and
argument schema but never its name*. It literally cannot route by name or by a
baked-in rule — only by what the tool says it does.

That turned into a clean little proof. Swap the two tools' descriptions and leave
everything else identical — the agent's choice swaps with them. With a real model:
a "charged twice, need a refund" task selects the account lookup; a "how do I
reset my password" task selects help-centre search. Same names, different
descriptions, correct routing. The description is the contract.

And it pays off end-to-end. Run the triage agent with MCP on, and it doesn't
invent account facts anymore — it calls the lookup, finds the two real duplicate
invoices, and **cites those exact invoice numbers** in the draft reply, with the
priority the policy resource told it to use. Grounded, not guessed.

One deliberate restraint: the tool *call* happens over MCP, but the model still
talks to my code through the same plain text-in/text-out seam every other phase
uses. I didn't bolt on provider-native function-calling. That seam is what lets a
gateway sit in front of every model call next cycle, and what lets the whole thing
run air-gapped later — worth keeping narrow even when a shortcut is right there.

Server (one resource, two tools, stdio + HTTP transports), the name-blind
selector, and the worked example are in the repo. If you're wiring an agent to
real systems: decide tool-vs-resource by *who's in control*, and make your
descriptions good enough that they — not a prompt rule — do the routing.

Next cycle: the LLM gateway — why guardrails belong there, not in the prompt.
