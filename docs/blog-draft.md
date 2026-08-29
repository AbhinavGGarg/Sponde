# We built a deal room for AI agents in one day — and made it need two human keys

*Draft for the blog track. Fill the [BRACKETED] sections from the live runs before publishing. Publish anywhere; keep every claim matched to the repo.*

At 9:30 this morning, someone from the host company told us they were tired of seeing security projects at hackathons. By 10:00 we had thrown away a finished project and started over. This is the story of Sponde — the two-key deal room for personal agents — built in one day on the TrueForge agent harness.

## The idea we almost shipped, and why we didn't

We arrived with a complete, tested incident-response agent. It was good. It was also nearly identical to the example walkthrough in the event's own brief — and a conversation at breakfast convinced us that originality was the axis we were about to lose on. So we kept the architecture lessons and pivoted to the gap the agent future actually has: everyone is about to have a personal agent, and there is nowhere for two of them to meet.

## What Sponde is

Your agent knows your calendar, budget, and allergies. Mine knows mine. They connect through a room — an MCP server we wrote — and negotiate. Three rules make it a product instead of a demo:

1. **Only validated offer fields cross the wire.** The room's schema rejects unknown fields, prose dumps, and oversized payloads. There's a test that tries to smuggle `shellfish_allergy: true` through an offer; it bounces. (We're careful about the claim: direct transmission is closed; inference from offers is not, and we say so.)
2. **Nothing becomes actionable until both humans approve the exact same terms.** `commit_deal` is the only actionable tool. It's annotated destructive *and* listed by literal name in each agent's approval policy — two layers, because we'd read TrueForge issue #318 about annotation-only gating failing open. Each side's commit freezes in that side's own TrueForge session until that human clicks Allow.
3. **The action happens exactly once.** On seal, the room issues a mutually approved agreement receipt (SHA-256 over the transcript) and a calendar hold generated deterministically from the sealed terms — retries are byte-identical.

## What the harness did so we didn't have to

We wrote one MCP server, two agent manifests, a kickoff driver, and a UI. We wrote zero lines of: agent loop, approval flow, event streaming, session persistence. TrueForge ran two concurrent sessions, gated the destructive tool per side, and kept a negotiation alive through a browser refresh mid-approval. The long-poll `wait_for_reply` tool let both agents converse live *inside* their turns — the trick that makes two harness sessions feel like one conversation.

## What broke along the way

- [LIVE RUN NOTES: first negotiation behavior, prompt fixes, anything weird]
- The SDK's types are camelCase while the docs show snake_case wire format — cost us a typecheck cycle.
- Our first scroll animation loaded GSAP from a CDN; the sandbox we built in couldn't reach it and failed *silently* to a fallback. We vendored the library — never let venue Wi-Fi own your demo.
- An earlier version showed Qodo as a runtime layer in our architecture page. Our own reviewer called it out: Qodo is build-time proof, not a runtime ingredient. It's a review rail beside the stack now. The correction mattered more than the polish.
- [QODO FINDINGS: the most meaningful finding, our response, the fix, the test added]

## Honest limits

The sealed agreement is a receipt and a calendar hold, not a legal contract or a restaurant reservation. The transcript hash is self-authenticated. Counterparts can infer preferences from offers even though they can't read constraints. Rooms are in-memory; durability of the negotiation lives in TrueForge's sessions — which is rather the point.

## What's next

N-party rooms (the two-key primitive generalizes to N keys), real booking connectors behind the same dual gate, and live web evidence on every offer — offers already carry `source_url` and `retrieved_at` when the Bright Data connector is attached, so the negotiation argues from tonight's truth instead of a model's priors.

*Repo: [URL] · Built at the Agent Harness Hackathon, San Francisco, Aug 29, 2026. AI-assistance disclosure: architecture, code, and this post were developed with AI pair-assistants (Claude, Codex); every line was reviewed, tested, and shipped by the team, with Qodo review on every substantive PR.*
