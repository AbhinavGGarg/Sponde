# 3-minute demo runbook

Stage: three windows. Left = agent-abhinav's TrueForge chat. Right = agent-priya's. Center = the operator view (http://localhost:7400). Phone visible if the Slack webhook is set.

**0:00 — The thesis.** "Everyone in this room will have a personal agent. Where do two of them meet? And when they make a deal — who said yes?" Type into the box: *book dinner for Abhinav and Priya this weekend* → **CONNECT THE LINES**.

**0:20 — Privacy by validation.** As offers start crossing: "Abhinav's agent knows his budget and his shellfish allergy. Priya's knows she's vegetarian and busy till 7:30. Watch the wire — only validated offer fields cross. The room *rejects* anything else; there's a test that tries to smuggle an allergy through and bounces."

**0:50 — Live negotiation.** Narrate the counters from the operator view — real, unscripted, each agent pushing for its own human. Point at the status strip: doing / waiting on / did. If Bright Data is connected, point at `source_url` + `retrieved_at` inside an offer: "that venue fact was fetched live, mid-negotiation."

**1:40 — THE moment: two keys.** Terms converge; `commit_deal` fires; the hazard banner: IRREVERSIBLE STEP PAUSED. "We wrote zero approval code — the harness gates this tool by annotation and by name. And one yes is not enough." Abhinav approves in the left window — *still not sealed*. Optional flex: refresh the browser here; the session and the pause survive. Then Priya approves on the right —

**2:15 — Sealed, and something real happens.** The stamp lands: transcript SHA-256, and the **ADD TO CALENDAR** link — a real .ics generated from the sealed terms, exactly once (retries are byte-identical; there's a test). Click it, show the event. "Two agents negotiated. Two humans turned their keys. One calendar hold, one receipt."

**2:35 — The anatomy.** Flip to `/how`, scroll the sealed deal apart: consent → TrueForge → the models → the room → live data, with Qodo as the build rail beside the stack. "Every layer is load-bearing — remove any one and the demo you just watched breaks."

**2:50 — Close.** "Dinner is the easiest demo. The same room prices a contract, books a vendor, settles a trade. The two-key deal room for the agent economy." Repo URL.

## Failure saves

- Agents dawdle → narrate from the operator view; it's always moving.
- One side refuses to commit → "no deal without two yeses — that's the feature," show `leave_room`.
- TrueForge/model outage → `npm run rehearse` drives the identical server code at human pace, **clearly labeled SCRIPTED REHEARSAL on every screen** — say what it is, walk the arc, and show `npm test` (17 tests) for the protocol claims.
- Wi-Fi dies → everything is loopback; nothing in the core demo needs the internet.

## Q&A ammo

- *"What did you write vs. the harness?"* — one MCP server (the room), two agent manifests, a kickoff driver, this UI. Zero lines of agent loop, approval flow, streaming, or session persistence — that's TrueForge, visibly.
- *"Isn't this the 'agent communication' idea someone suggested?"* — the space, yes; the design is ours: strict offer schema so constraints have no channel, dual matching commits, per-side approval gates, idempotent real action. Ideas are cheap; this runs.
- *"Couldn't OpenAI build this?"* — they'd build the agent. Sponde is the *neutral room between* agents from different owners — the piece no single agent vendor can be trusted to own. Neutrality is the product.
- *"What if agents infer secrets from offers?"* — correct, inference is possible and we say so; what's closed is the direct channel. That's the honest limit, and it's in the README.
- *"Is the deal legally binding?"* — no, and we never claim it: it's a mutually approved agreement receipt plus a calendar hold.
- *"Why only two parties?"* — two keys is the primitive. N-party rooms are the roadmap; get the primitive right first.
