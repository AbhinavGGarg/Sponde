import type { ActivityBoard, AgentActivity } from './activity.js';
import type { Room, RoomMessage } from './rooms.js';

/**
 * The operator's window — a server-rendered, read-only view of one room,
 * styled like the thing Sponde is named after. This page sits between
 * the two TrueForge chat windows in the demo; it never exposes line tokens
 * and takes no actions.
 */

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function offerCard(body: Record<string, unknown>): string {
  const chips: string[] = [];
  const chip = (label: string, cls = '') =>
    chips.push(`<span class="chip ${cls}">${esc(label)}</span>`);

  const title = body.option ?? body.item;
  const price = body.price_pp ?? body.price;
  if (body.place) chip(String(body.place), 'place');
  if (body.date || body.time) chip([body.date, body.time].filter(Boolean).join(' · '), 'time');
  if (price !== undefined) chip(`$${price}${body.price_pp !== undefined ? '/person' : ''}`, 'price');
  if (body.duration_minutes) chip(`${body.duration_minutes} min`);
  if (body.quantity) chip(`×${body.quantity}`);
  if (body.source_url) {
    chips.push(
      `<a class="chip source" href="${esc(String(body.source_url))}" target="_blank" rel="noreferrer">⛓ live source${
        body.retrieved_at ? esc(` · ${String(body.retrieved_at).slice(11, 16)}`) : ''
      }</a>`,
    );
  } else if (body.unverified) {
    chip('unverified', 'unverified');
  }
  if (body.committed) chip('COMMITTED', 'committed');

  return `${title ? `<div class="offer-title">${esc(String(title))}</div>` : ''}
    ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    ${body.reason ? `<div class="reason">${esc(String(body.reason))}</div>` : ''}
    ${body.terms ? `<div class="reason">“${esc(String(body.terms))}”</div>` : ''}
    <details class="raw"><summary>raw offer</summary><code>${esc(JSON.stringify(body))}</code></details>`;
}

function messageRow(m: RoomMessage, left: string): string {
  const side = m.from === left ? 'left' : 'right';
  const kindClass = ['accept', 'reject'].includes(m.kind) ? ` ${m.kind}` : '';
  const body = (m.body ?? {}) as Record<string, unknown>;
  return `<div class="msg ${side}${kindClass}">
    <div class="msghead">
      <span class="seq">#${String(m.seq).padStart(3, '0')}</span>
      <span class="from">${esc(m.from)}</span>
      <span class="kind">${esc(m.kind.toUpperCase())}</span>
      <span class="at">${esc(m.at.slice(11, 19))}</span>
    </div>
    <div class="msgbody">${offerCard(body)}</div>
  </div>`;
}

const STATE_LABEL: Record<string, string> = {
  idle: 'IDLE',
  negotiating: 'DOING · negotiating',
  waiting_reply: 'WAITING ON · the other side',
  awaiting_human: 'WAITING ON · ITS HUMAN',
  done: 'DONE',
};

function jackStatus(activity: AgentActivity | undefined): string {
  if (!activity) return '';
  // Everything here is driver-supplied text — escape it all. (Qodo finding:
  // unescaped detail permitted stored XSS via POST /activity.)
  const label = esc(STATE_LABEL[activity.state] ?? activity.state);
  const cls = activity.state === 'awaiting_human' ? 'gatewait' : 'doing';
  const detail = activity.detail ? esc(` — ${activity.detail}`) : '';
  return `<div class="${cls}">${label}${detail ? `<span class="detail">${detail}</span>` : ''}</div>`;
}

export function renderRoomPage(room: Room, board?: ActivityBoard): string {
  const handles = [...room.participants.keys()];
  const left = handles[0] ?? '—';
  const right = handles[1] ?? '(line open)';
  const connected = handles.length === 2;
  const committed = new Set(room.commitments.keys());
  const pending = board?.pendingHuman() ?? [];

  const gateBanner =
    pending.length > 0 && room.status !== 'sealed'
      ? `<div class="gate">⚠ IRREVERSIBLE STEP PAUSED — ${pending
          .map((p) => `<b>${esc(p.agent)}</b> wants to commit the deal`)
          .join(' · ')}. Nothing is booked until its human presses <b>Allow</b> in TrueForge. Sponde asks <i>before</i>, never after.</div>`
      : '';

  const statusLabel = {
    open: 'LINE OPEN — AWAITING SECOND PARTY',
    negotiating: 'LIVE — NEGOTIATION IN PROGRESS',
    sealed: 'DEAL SEALED',
    abandoned: 'LINE CLOSED — NO DEAL',
  }[room.status];

  const sealBlock = room.seal
    ? `<div class="seal"><div class="stamp">SEALED</div>
       <div class="sealmeta">mutually approved agreement · ${esc(room.seal.sealedAt)}<br/>
       transcript sha256 <code>${esc(room.seal.sha256)}</code><br/>
       <a href="/room/${esc(room.id)}/calendar.ics" style="color:var(--ok)">⬇ ADD TO CALENDAR (.ics)</a></div></div>`
    : '';

  // Live updates via fetch-and-morph — no full-page refresh flash, scroll
  // position preserved, paused while the reader has a raw-offer panel open.
  const live = room.status !== 'sealed' && room.status !== 'abandoned';
  const poll = live
    ? `<script>
      setInterval(async () => {
        if (document.querySelector('details[open]')) return;
        try {
          const html = await (await fetch(location.href)).text();
          const next = new DOMParser().parseFromString(html, 'text/html');
          if (next.body.innerHTML !== document.body.innerHTML) {
            const y = window.scrollY;
            document.body.replaceChildren(...next.body.childNodes);
            window.scrollTo(0, y);
          }
        } catch {}
      }, 1500);
    </script>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sponde · ${esc(room.id)}</title>
<style>
  :root { --bg:#0d0c0a; --panel:#161311; --line:#2a241f; --text:#efe7da; --dim:#8d8272;
          --brass:#e0a93e; --ok:#7fc97f; --no:#e06c5d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; }
  header { padding:20px 28px; border-bottom:1px solid var(--line); display:flex;
           justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;}
  .brand { letter-spacing:.35em; font-weight:700; color:var(--brass); }
  .topic { color:var(--dim); }
  .status { padding:3px 10px; border:1px solid var(--brass); color:var(--brass);
            font-size:12px; letter-spacing:.15em; }
  .status.sealed { border-color:var(--ok); color:var(--ok); }
  .status.abandoned { border-color:var(--no); color:var(--no); }
  .lines { display:flex; align-items:center; gap:0; padding:26px 28px 6px; }
  .jack { flex:1; border:1px solid var(--line); background:var(--panel); padding:14px 18px; }
  .jack .label { color:var(--dim); font-size:11px; letter-spacing:.2em; }
  .jack .handle { font-size:18px; margin-top:4px; }
  .jack .committed { color:var(--ok); font-size:12px; margin-top:6px; }
  .cable { width:120px; height:2px; position:relative;
           background:${connected ? 'var(--brass)' : 'var(--line)'}; }
  .cable::after { content:'${connected ? '● CONNECTED' : '○ WAITING'}'; position:absolute;
                  top:-20px; left:50%; transform:translateX(-50%); font-size:10px;
                  letter-spacing:.15em; color:${connected ? 'var(--brass)' : 'var(--dim)'};
                  white-space:nowrap; }
  .wire { margin:20px 28px; border:1px solid var(--line); background:var(--panel); }
  .wire h2 { margin:0; padding:10px 16px; font-size:11px; letter-spacing:.25em;
             color:var(--dim); border-bottom:1px solid var(--line); font-weight:400; }
  .msg { display:block; padding:10px 16px 12px; border-bottom:1px dotted var(--line); font-size:13px; }
  .msg.right { background:#131110; }
  .msghead { display:flex; gap:12px; align-items:baseline; }
  .msg .seq { color:var(--dim); font-size:11px; }
  .msg .from { color:var(--brass); }
  .msg .kind { color:var(--dim); font-size:11px; letter-spacing:.14em; border:1px solid var(--line);
               padding:1px 7px; }
  .msg.accept .kind { color:var(--ok); border-color:var(--ok); }
  .msg.reject .kind { color:var(--no); border-color:var(--no); }
  .msg .at { color:var(--dim); font-size:11px; margin-left:auto; }
  .msgbody { margin-top:6px; }
  .offer-title { font-size:15px; color:var(--text); }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
  .chip { border:1px solid var(--line); background:#100e0c; color:var(--text); padding:2px 9px;
          font-size:11.5px; letter-spacing:.03em; text-decoration:none; }
  .chip.price { border-color:var(--brass); color:var(--brass); }
  .chip.time { color:var(--text); }
  .chip.place { color:var(--dim); }
  .chip.unverified { border-color:#7a5c1e; color:#c9a45a; font-style:italic; }
  .chip.source { border-color:var(--ok); color:var(--ok); }
  .chip.committed { border-color:var(--ok); color:var(--ok); letter-spacing:.15em; }
  .reason { color:var(--dim); font-size:12px; margin-top:6px; max-width:70ch; line-height:1.6; }
  .raw { margin-top:6px; }
  .raw summary { color:#4d443a; font-size:10.5px; cursor:pointer; letter-spacing:.08em; }
  .raw code { display:block; color:var(--dim); font-size:11px; overflow-wrap:anywhere; padding:6px 0 0; }
  .gate { margin:16px 28px 0; border:2px solid var(--brass); background:repeating-linear-gradient(
            -45deg, #1c1710, #1c1710 12px, #211a0e 12px, #211a0e 24px);
          color:var(--brass); padding:14px 18px; font-size:13px; line-height:1.6; }
  .doing { color:var(--dim); font-size:11px; margin-top:6px; letter-spacing:.08em; }
  .doing .detail { color:var(--text); }
  .gatewait { color:var(--brass); font-size:11px; margin-top:6px; letter-spacing:.08em; }
  .seal { margin:8px 28px 28px; border:1px solid var(--ok); padding:18px;
          display:flex; gap:18px; align-items:center; }
  .stamp { border:3px double var(--ok); color:var(--ok); padding:10px 14px;
           font-size:20px; letter-spacing:.3em; transform:rotate(-4deg); }
  .sealmeta { color:var(--dim); font-size:12px; line-height:1.7; }
  .sealmeta code { color:var(--text); font-size:11px; overflow-wrap:anywhere; }
  footer { color:var(--dim); font-size:11px; padding:0 28px 24px; letter-spacing:.05em; }
</style></head>
<body>
<header>
  <span class="brand"><a href="/" style="color:inherit;text-decoration:none">SPONDE</a></span>
  <span class="topic">${esc(room.topic)} · ${esc(room.id)}</span>
  <span style="display:flex;gap:18px;align-items:baseline">
    <a href="/how" style="color:var(--dim);font-size:11px;letter-spacing:.2em;text-decoration:none">HOW&nbsp;IT&nbsp;WORKS</a>
    <span class="status ${esc(room.status)}">${esc(statusLabel)}</span>
  </span>
</header>
${gateBanner}
<div class="lines">
  <div class="jack">
    <div class="label">LINE 1</div>
    <div class="handle">${esc(left)}</div>
    ${jackStatus(board?.for(left))}
    ${committed.has(left) ? '<div class="committed">✓ COMMITTED (human approved)</div>' : ''}
  </div>
  <div class="cable"></div>
  <div class="jack">
    <div class="label">LINE 2</div>
    <div class="handle">${esc(right)}</div>
    ${jackStatus(board?.for(right))}
    ${committed.has(right) ? '<div class="committed">✓ COMMITTED (human approved)</div>' : ''}
  </div>
</div>
<div class="wire">
  <h2>ON THE WIRE — ONLY VALIDATED OFFER FIELDS CROSS. RAW CONSTRAINTS HAVE NO CHANNEL.</h2>
  ${room.messages.map((m) => messageRow(m, left)).join('\n') || '<div class="msg"><span class="body">silence on the line…</span></div>'}
</div>
${sealBlock}
<footer>read-only operator view · every commit above passed a human approval gate in TrueForge · the room keeps no credentials</footer>
${poll}
</body></html>`;
}

export function renderIndexPage(rooms: Room[], board?: ActivityBoard, driverRunning = false): string {
  const rows = rooms
    .map(
      (r) =>
        `<div class="msg"><span class="seq">${esc(r.id)}</span><span class="from">${esc(
          [...r.participants.keys()].join(' ⇄ ') || '—',
        )}</span><span class="body">${esc(r.topic)}</span><span class="kind">${esc(
          r.status.toUpperCase(),
        )}</span><span class="at"><a style="color:#e0a93e" href="/room/${esc(r.id)}">open</a></span></div>`,
    )
    .join('\n');
  const activity = (board?.all() ?? [])
    .map(
      (a) =>
        `<div class="msg"><span class="from">${esc(a.agent)}</span><span class="body">${esc(
          STATE_LABEL[a.state] ?? a.state,
        )}${a.detail ? ` — ${esc(a.detail)}` : ''}</span><span class="kind">${esc(a.at.slice(11, 19))}</span></div>`,
    )
    .join('\n');

  const startForm = driverRunning
    ? `<div class="startbox running">a negotiation is on the wire — scroll down and open its room</div>`
    : `<form class="startbox" method="post" action="/start">
        <input name="task" placeholder="What should the agents negotiate? e.g. book dinner for Abhinav and Priya this weekend" autofocus />
        <button type="submit">CONNECT THE LINES</button>
       </form>`;

  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sponde · operator</title>
<style>body{margin:0;background:#0d0c0a;color:#efe7da;font-family:ui-monospace,Menlo,monospace}
header{padding:20px 28px;border-bottom:1px solid #2a241f;display:flex;justify-content:space-between;align-items:baseline}
.brand{letter-spacing:.35em;font-weight:700;color:#e0a93e}
.tag{color:#8d8272;font-size:12px}
.startbox{display:flex;gap:10px;margin:22px 28px;padding:0}
.startbox.running{color:#e0a93e;border:1px dashed #e0a93e;padding:14px 18px;font-size:13px;letter-spacing:.06em}
.startbox input{flex:1;background:#161311;border:1px solid #2a241f;color:#efe7da;padding:12px 14px;
  font:inherit;font-size:14px}
.startbox input:focus{outline:1px solid #e0a93e}
.startbox button{background:#e0a93e;border:0;color:#0d0c0a;font:inherit;font-weight:700;
  letter-spacing:.12em;padding:12px 20px;cursor:pointer}
h2{margin:18px 28px 0;font-size:11px;letter-spacing:.25em;color:#8d8272;font-weight:400}
.msg{display:flex;gap:16px;padding:10px 28px;border-bottom:1px dotted #2a241f;font-size:13px}
.seq{color:#8d8272}.from{color:#e0a93e;min-width:220px}.body{flex:1}.kind{color:#8d8272}.at a{color:#e0a93e}</style>
</head><body>
<header><span class="brand">SPONDE</span><span class="tag">my agent will talk to your agent · <a href="/how" style="color:#e0a93e;text-decoration:none">HOW IT WORKS →</a></span></header>
${startForm}
<h2>AGENTS ON DUTY</h2>
${activity || '<div class="msg"><span class="body">no agents reporting yet</span></div>'}
<h2>LINES</h2>
${rows || '<div class="msg"><span class="body">no lines connected yet</span></div>'}
<script>
  // Live updates that NEVER interrupt typing: the swap is skipped while the
  // task input is focused or holds text.
  setInterval(async () => {
    const input = document.querySelector('.startbox input');
    if (input && (document.activeElement === input || input.value.length > 0)) return;
    try {
      const html = await (await fetch(location.href)).text();
      const next = new DOMParser().parseFromString(html, 'text/html');
      if (next.body.innerHTML !== document.body.innerHTML) {
        const y = window.scrollY;
        document.body.replaceChildren(...next.body.childNodes);
        window.scrollTo(0, y);
      }
    } catch {}
  }, 2000);
</script>
</body></html>`;
}
