# Ready-to-paste PR descriptions

## PR 1 — `feat/switchboard` → `main`

**Title:** feat: the two-key deal room — MCP room server, dual-approval agents, operator view, calendar hold

**Body:**

Sponde is a neutral room where two people's agents negotiate and nothing becomes actionable until both humans approve the exact same terms.

What's in this PR:
- `src/server/` — the room as an MCP server (Streamable HTTP): create/join, validated offers (strict schema — unknown fields rejected), long-poll `wait_for_reply`, dual-commit sealing with SHA-256 transcript, deterministic calendar hold (`/room/:id/calendar.ics`, issued exactly once), and the operator view + `/how` anatomy page (GSAP vendored, reduced-motion fallback).
- `src/scripts/` — `seed-agents` (two TrueForge manifests; `commit_deal` approval-gated by literal name AND `@destructive` annotation), `negotiate` (two-session kickoff driver + notifications; never negotiates or approves), `rehearse` (clearly-labeled scripted rehearsal, no model/TrueForge involved).
- `test/` — 17 tests: room state machine, line-token integrity, terms-match sealing, seal immutability, MCP annotation contract, and the go/no-go set (unknown-field rejection, oversized payloads, transcript key allowlist, calendar-hold idempotency, invalid `starts_at` rejection).

Design notes for review:
- Privacy claim is deliberately scoped: raw constraints have no channel (schema-enforced); inference from offers remains possible and is documented.
- The approval policy never relies on MCP annotations alone (cf. trueforge#318).
- The driver reports display-state to `/activity`; the room store is the only source of truth.

**AI-assistance disclosure:** built with AI pair-assistants (Claude, Codex) under team direction; all code reviewed and tested by the team before this PR.

---

## Follow-up PRs (as the day produces them)

- `fix/live-run-tuning` — prompt/protocol adjustments from the first live negotiations (link the run transcript).
- `feat/brightdata-evidence` — only if the connector is live: evidence rule already in the manifests; this PR adds any glue + updates `/how` copy to match reality.
- `docs/demo` — final README polish, screenshots, blog link, video link.

For every Qodo finding: fix it or answer it in-thread with a reason. Merge only after the thread is resolved.
