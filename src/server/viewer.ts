import type { ActivityBoard, AgentActivity } from './activity.js';
import type { Room, RoomMessage } from './rooms.js';

/**
 * The operator's window — a server-rendered, read-only view of the deal room,
 * built for the Best-UI bar: a stranger can pick it up and drive. The visual
 * spine is the track brief itself — what each agent is DOING, what it is
 * WAITING ON, what it DID — and the approval gate is the loudest element on
 * the page, because asking BEFORE the irreversible step is the product.
 * This page never exposes line tokens and takes no actions.
 */

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Shared look: aged-gold on ink, editorial serif for the voice of the house,
 *  mono for the machine truth. Fonts fall back to system faces offline. */
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Space+Grotesk:wght@300..600&display=swap" rel="stylesheet">`;

const TOKENS = `
  :root {
    --ink:#0b0a08; --ink2:#12100c; --panel:#171410; --panel2:#1d1913;
    --line:#2b251c; --line2:#3a3226;
    --text:#f0e8d8; --dim:#9a8c78; --faint:#645949;
    --gold:#d9a441; --gold2:#f0c46a; --golddim:#8a6c2f;
    --ok:#7ecb8f; --okdim:#3d6b48; --no:#e06c5d;
    --serif:'Fraunces', Georgia, 'Times New Roman', serif;
    --sans:'Space Grotesk', -apple-system, 'Helvetica Neue', sans-serif;
    --mono:ui-monospace, 'SF Mono', Menlo, monospace;
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { margin:0; background:var(--ink); color:var(--text); font-family:var(--sans);
         -webkit-font-smoothing:antialiased; }
  a { color:var(--gold); }
  ::selection { background:var(--gold); color:var(--ink); }
  .dust { position:fixed; inset:0; pointer-events:none; z-index:-1; overflow:hidden; }
  .dust span { position:absolute; border-radius:50%; background:var(--gold2);
    box-shadow:0 0 10px var(--gold), 0 0 3px var(--gold2); opacity:var(--op,.5);
    animation:dustdrift ease-in-out infinite alternate; }
  @keyframes dustdrift {
    from { transform:translateY(20px) translateX(0); }
    50%  { opacity:calc(var(--op,.3) + .3); }
    to   { transform:translateY(-30px) translateX(8px); }
  }
`;

/** Slow-drifting gold motes so the ink never reads as a flat void. */
const dust = (n: number): string => {
  const spans = Array.from({ length: n }, (_, i) => {
    const left = (i * 61 + 7) % 100;
    const top = (i * 37 + 11) % 100;
    const size = 2 + ((i * 7) % 4);
    const dur = 6 + ((i * 13) % 9);
    const delay = -((i * 17) % 14);
    const op = (38 + ((i * 11) % 42)) / 100;
    return `<span style="left:${left}%;top:${top}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;--op:${op}"></span>`;
  }).join('');
  return `<div class="dust" aria-hidden="true">${spans}</div>`;
};

/* ---------------------------------------------------------------- offers */

/** Fields whose turn-to-turn movement IS the negotiation. */
const DIFF_KEYS = ['option', 'item', 'place', 'date', 'time', 'price', 'price_pp', 'duration_minutes', 'quantity'];

function offerCard(body: Record<string, unknown>, changed?: Set<string>, hasPrev = false): string {
  const chips: string[] = [];
  // Repetition fades, movement pops: a chip whose value changed since the
  // previous offer glows gold; one merely restated dims back.
  const diffCls = (keys: string[]): string => {
    if (keys.length === 0) return ''; // evidence/committed chips never dim
    if (changed && keys.some((k) => changed.has(k))) return ' delta';
    return hasPrev ? ' same' : '';
  };
  const chip = (label: string, cls = '', keys: string[] = []) =>
    chips.push(`<span class="chip ${cls}${diffCls(keys)}">${esc(label)}</span>`);

  const title = body.option ?? body.item;
  const price = body.price_pp ?? body.price;
  if (body.place) chip(String(body.place), 'place', ['place']);
  if (body.date || body.time) chip([body.date, body.time].filter(Boolean).join(' · '), 'time', ['date', 'time']);
  if (price !== undefined) chip(`$${price}${body.price_pp !== undefined ? ' /person' : ''}`, 'price', ['price', 'price_pp']);
  if (body.duration_minutes) chip(`${body.duration_minutes} min`, '', ['duration_minutes']);
  if (body.quantity) chip(`× ${body.quantity}`, '', ['quantity']);
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
    ${body.terms ? `<div class="reason terms">“${esc(String(body.terms))}”</div>` : ''}
    <details class="raw"><summary>raw offer — exactly what crossed the wire</summary><code>${esc(JSON.stringify(body))}</code></details>`;
}

function messageRow(m: RoomMessage, left: string, changed?: Set<string>, hasPrev = false, latest = false): string {
  const side = m.from === left ? 'left' : 'right';
  const kindClass = ['accept', 'reject'].includes(m.kind) ? ` ${m.kind}` : '';
  const body = (m.body ?? {}) as Record<string, unknown>;
  return `<div class="msg ${side}${kindClass}${latest ? ' latest' : ''}">
    <div class="msghead">
      <span class="from">${esc(m.from)}</span>
      <span class="kind">${esc(m.kind.toUpperCase())}</span>
      ${latest ? '<span class="livepill">◈ LATEST</span>' : ''}
      <span class="at">#${String(m.seq).padStart(3, '0')} · ${esc(m.at.slice(11, 19))}</span>
    </div>
    <div class="msgbody">${offerCard(body, changed, hasPrev)}</div>
  </div>`;
}

/* ------------------------------------------------------------- activity */

const STATE_LABEL: Record<string, string> = {
  idle: 'IDLE',
  negotiating: 'DOING · negotiating',
  waiting_reply: 'WAITING ON · the other side',
  awaiting_human: 'WAITING ON · ITS HUMAN',
  done: 'DONE',
};

function jackStatus(activity: AgentActivity | undefined, roomStatus?: string): string {
  // A closed room's live status is history — show the terminal state, never
  // a stale "negotiating". (Cosmetic fix for sealed rooms.)
  if (roomStatus === 'sealed') return `<div class="doing done"><span class="dot ok"></span>DONE — agreement sealed</div>`;
  if (roomStatus === 'abandoned') return `<div class="doing"><span class="dot off"></span>CLOSED — no deal</div>`;
  if (!activity) return `<div class="doing"><span class="dot off"></span>STANDING BY</div>`;
  // Everything here is driver-supplied text — escape it all. (Qodo finding:
  // unescaped detail permitted stored XSS via POST /activity.)
  const label = esc(STATE_LABEL[activity.state] ?? activity.state);
  const waiting = activity.state === 'awaiting_human';
  const dot = waiting ? 'gold' : activity.state === 'done' ? 'ok' : 'live';
  const cls = waiting ? 'gatewait' : 'doing';
  const detail = activity.detail ? esc(` — ${activity.detail}`) : '';
  return `<div class="${cls}"><span class="dot ${dot}"></span>${label}${detail ? `<span class="detail">${detail}</span>` : ''}</div>`;
}

/* ------------------------------------------------------------ room page */

const monogram = (handle: string): string =>
  (handle.replace(/^(agent|switchboard)[-_]/, '')[0] ?? '·').toUpperCase();

export function renderRoomPage(room: Room, board?: ActivityBoard): string {
  const handles = [...room.participants.keys()];
  const left = handles[0] ?? '—';
  const right = handles[1] ?? 'awaiting second party';
  const connected = handles.length === 2;
  const committed = new Set(room.commitments.keys());
  const keys = committed.size;
  const pending = board?.pendingHuman(room.id) ?? [];
  const mailOn = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

  const gateBanner =
    pending.length > 0 && room.status !== 'sealed'
      ? `<div class="gate">
           <div class="gate-key">⏸</div>
           <div>
             <div class="gate-title">IRREVERSIBLE STEP PAUSED — A HUMAN DECIDES</div>
             <div class="gate-sub">${pending
               .map((p) => `<b>${esc(p.agent)}</b> wants to commit the deal`)
               .join(' · ')}. Nothing is booked until its human presses <b>Allow</b> in TrueForge.
               Sponde asks <i>before</i> — never after.</div>
           </div>
         </div>`
      : '';

  const statusLabel = {
    open: 'LINE OPEN',
    negotiating: 'LIVE',
    sealed: 'DEAL SEALED',
    abandoned: 'NO DEAL',
  }[room.status];

  const sealBlock = room.seal
    ? `<section class="seal">
        <div class="wax"><span>SPONDE</span><b>SEALED</b><span>· TWO KEYS ·</span></div>
        <div class="sealmeta">
          <div class="sealhead">Mutually approved agreement</div>
          <div class="sealline">Both humans turned their key on identical terms · ${esc(room.seal.sealedAt.slice(0, 19).replace('T', ' · '))}</div>
          <div class="sealhash">transcript sha256 <code>${esc(room.seal.sha256)}</code></div>
          <div class="sealactions">
            <a class="btn" href="/room/${esc(room.id)}/calendar.ics">⬇ ADD TO CALENDAR</a>
            ${mailOn ? '<span class="mailnote">✉ calendar invite emailed to both humans — exactly once</span>' : ''}
          </div>
        </div>
      </section>`
    : '';

  const keyState = (h: string): string =>
    committed.has(h)
      ? `<div class="keyslot turned">🔑 KEY TURNED<span>human approved</span></div>`
      : `<div class="keyslot">🔒 KEY NOT TURNED<span>commit needs its human</span></div>`;

  // Diff each offer against the previous one so the ledger shows MOVEMENT,
  // not repetition — the negotiation's story is what changed hands.
  const OFFERISH = new Set(['propose', 'counter', 'accept', 'reject']);
  let prevOffer: Record<string, unknown> | undefined;
  const lastSeq = room.messages.length;
  const rows = room.messages
    .map((m) => {
      const body = (m.body ?? {}) as Record<string, unknown>;
      let changed: Set<string> | undefined;
      let hasPrev = false;
      if (OFFERISH.has(m.kind)) {
        if (prevOffer) {
          hasPrev = true;
          const prev = prevOffer;
          changed = new Set(DIFF_KEYS.filter((k) => JSON.stringify(body[k]) !== JSON.stringify(prev[k])));
        }
        prevOffer = body;
      }
      return messageRow(m, left, changed, hasPrev, m.seq === lastSeq);
    })
    .join('\n');

  const lastMsg = room.messages[room.messages.length - 1];
  const lastBody = (lastMsg?.body ?? {}) as Record<string, unknown>;
  const lastPrice =
    lastBody.price_pp !== undefined ? `$${lastBody.price_pp}/person` : lastBody.price !== undefined ? `$${lastBody.price}` : undefined;
  const tickerBits = lastMsg
    ? [`#${String(lastMsg.seq).padStart(3, '0')}`, lastMsg.from, lastMsg.kind.toUpperCase(), lastBody.time ?? lastBody.date, lastPrice]
        .filter((x): x is string | number => x !== undefined && x !== '')
        .map((x) => esc(String(x)))
    : [];

  // Live updates via fetch-and-morph — no full-page refresh flash, scroll
  // position preserved, paused while the reader has a raw-offer panel open.
  // On every new wire message, a gold pulse travels the cable from the
  // sending agent's side to the receiver's.
  const live = room.status !== 'sealed' && room.status !== 'abandoned';
  const ticker =
    lastMsg && live
      ? `<div class="ticker"><span class="tdot"></span>${tickerBits.join('&nbsp;·&nbsp;')}</div>`
      : '';
  const poll = live
    ? `<script>
      function spondePulse() {
        var wire = document.querySelector('.wire');
        if (!wire) return;
        var seq = parseInt(wire.getAttribute('data-lastseq') || '0', 10);
        if (window.__spondeSeq === undefined) { window.__spondeSeq = seq; return; }
        if (seq <= window.__spondeSeq) return;
        window.__spondeSeq = seq;
        var cable = document.querySelector('.cable');
        if (!cable) return;
        var p = document.createElement('span');
        p.className = 'pulse' + (wire.getAttribute('data-lastside') === 'right' ? ' rtl' : '');
        cable.appendChild(p);
        setTimeout(function () { p.remove(); }, 1100);
      }
      spondePulse();
      setInterval(async () => {
        if (document.querySelector('details[open]')) return;
        try {
          const html = await (await fetch(location.href)).text();
          const next = new DOMParser().parseFromString(html, 'text/html');
          if (next.body.innerHTML !== document.body.innerHTML) {
            const y = window.scrollY;
            document.body.replaceChildren(...next.body.childNodes);
            window.scrollTo(0, y);
            spondePulse();
          }
        } catch {}
      }, 1500);
    </script>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sponde · ${esc(room.id)}</title>
${FONTS}
<style>
${TOKENS}
  body { background:
    radial-gradient(1100px 500px at 50% -10%, #1a150d 0%, transparent 60%), var(--ink); }

  header { padding:18px 32px; border-bottom:1px solid var(--line); display:flex;
           justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; }
  .brand { font-family:var(--serif); font-weight:600; font-size:19px; letter-spacing:.32em; color:var(--gold); }
  .brand a { color:inherit; text-decoration:none; }
  .topic { color:var(--dim); font-size:13.5px; max-width:52ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hright { display:flex; gap:18px; align-items:center; }
  .hlink { color:var(--dim); font-size:11px; letter-spacing:.22em; text-decoration:none; }
  .status { padding:4px 12px; border:1px solid var(--gold); color:var(--gold);
            font-size:11px; letter-spacing:.22em; border-radius:999px; }
  .status.live { animation:breathe 2.4s ease-in-out infinite; }
  .status.sealed { border-color:var(--ok); color:var(--ok); }
  .status.abandoned { border-color:var(--no); color:var(--no); }
  @keyframes breathe { 50% { box-shadow:0 0 14px rgba(217,164,65,.35); } }

  /* the gate — loudest thing on the page, on purpose */
  .gate { margin:20px 32px 0; display:flex; gap:18px; align-items:center;
          border:1px solid var(--gold); border-left:6px solid var(--gold); border-radius:10px;
          background:repeating-linear-gradient(-45deg, #1e180e, #1e180e 14px, #241c10 14px, #241c10 28px);
          background-size:200% 100%; animation:march 18s linear infinite;
          padding:18px 22px; box-shadow:0 0 40px rgba(217,164,65,.12); }
  @keyframes march { to { background-position:-80px 0; } }
  .gate-key { font-size:34px; }
  .gate-title { font-family:var(--serif); color:var(--gold2); font-size:19px; letter-spacing:.06em; }
  .gate-sub { color:var(--dim); font-size:13px; line-height:1.65; margin-top:4px; max-width:80ch; }
  .gate-sub b { color:var(--text); font-weight:600; }
  .gate-sub i { color:var(--gold); font-style:italic; }

  /* the two lines — DOING · WAITING ON · DID, per agent */
  .lines { display:flex; align-items:stretch; gap:0; padding:26px 32px 4px; }
  .jack { flex:1; border:1px solid var(--line); background:linear-gradient(180deg, var(--panel), var(--ink2));
          border-radius:12px; padding:18px 20px; min-width:0; }
  .jack .label { color:var(--faint); font-size:10px; letter-spacing:.3em; }
  .jack .who { display:flex; gap:12px; align-items:center; margin-top:8px; }
  .mono { width:38px; height:38px; border-radius:50%; border:1px solid var(--golddim);
          display:flex; align-items:center; justify-content:center; font-family:var(--serif);
          font-size:18px; color:var(--gold); background:#191408; flex:none; }
  .jack .handle { font-size:16.5px; font-weight:500; letter-spacing:.02em;
                  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .doing, .gatewait { display:flex; gap:8px; align-items:center; color:var(--dim); font-size:11.5px;
                      margin-top:12px; letter-spacing:.08em; }
  .doing.done { color:var(--ok); }
  .gatewait { color:var(--gold); }
  .doing .detail, .gatewait .detail { color:var(--text); letter-spacing:.02em; }
  .dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .dot.live { background:var(--gold); animation:pulse 1.4s ease-in-out infinite; }
  .dot.gold { background:var(--gold); animation:pulse .8s ease-in-out infinite; }
  .dot.ok { background:var(--ok); }
  .dot.off { background:var(--faint); }
  @keyframes pulse { 50% { opacity:.25; } }
  .keyslot { margin-top:12px; border-top:1px dashed var(--line); padding-top:10px;
             color:var(--faint); font-size:10.5px; letter-spacing:.18em; }
  .keyslot span { display:block; letter-spacing:.04em; margin-top:2px; color:var(--faint); font-size:10.5px; }
  .keyslot.turned { color:var(--ok); }
  .keyslot.turned span { color:var(--okdim); }

  .cable { width:150px; flex:none; position:relative; display:flex; flex-direction:column;
           align-items:center; justify-content:center; gap:8px; }
  .cable .wireline { width:100%; height:0; border-top:2px ${connected ? 'dashed var(--gold)' : 'solid var(--line)'};
           ${connected ? 'animation:flow 1.2s linear infinite;' : ''} }
  @keyframes flow { to { transform:translateX(14px); } }
  .cable .wiremask { position:absolute; top:0; left:0; right:0; bottom:0; overflow:hidden; }
  .cable .clabel { font-size:9.5px; letter-spacing:.24em; color:${connected ? 'var(--gold)' : 'var(--faint)'}; }
  .cable .keys { font-family:var(--serif); font-size:13px; color:${keys === 2 ? 'var(--ok)' : 'var(--dim)'};
                 letter-spacing:.1em; }

  /* the wire */
  .wire { margin:22px 32px; border:1px solid var(--line); border-radius:12px; background:var(--ink2); overflow:hidden; }
  .wire h2 { margin:0; padding:12px 20px; font-size:10.5px; letter-spacing:.26em;
             color:var(--faint); border-bottom:1px solid var(--line); font-weight:400;
             background:var(--panel); }
  .msg { padding:14px 20px 16px; border-bottom:1px solid var(--line); font-size:13.5px; }
  @keyframes rise { from { opacity:0; transform:translateY(4px); } }
  .msg:last-child { border-bottom:0; }
  .msg.latest { animation:rise .45s ease both; border-left-width:4px;
                background:linear-gradient(90deg, rgba(217,164,65,.07), transparent 55%); }
  .livepill { color:var(--gold); font-size:9px; letter-spacing:.22em; border:1px solid var(--golddim);
              border-radius:999px; padding:2px 9px; animation:pulse 1.4s ease-in-out infinite; }
  .chip.delta { border-color:var(--gold); color:var(--gold2); background:#1d1608;
                animation:chipflash 1.1s ease; }
  @keyframes chipflash { from { box-shadow:0 0 0 5px rgba(217,164,65,.35); } }
  .chip.same { opacity:.45; }
  .ticker { display:flex; gap:12px; align-items:center; padding:9px 32px;
            border-bottom:1px solid var(--line); color:var(--gold); font-family:var(--mono);
            font-size:12px; letter-spacing:.08em; background:rgba(217,164,65,.045);
            animation:rise .4s ease both; }
  .tdot { width:7px; height:7px; border-radius:50%; background:var(--gold); flex:none;
          animation:pulse 1.2s ease-in-out infinite; }
  .cable .pulse { position:absolute; top:calc(50% + 6px); width:10px; height:10px; border-radius:50%;
                  background:var(--gold2); box-shadow:0 0 14px var(--gold); z-index:2;
                  animation:travel 1s ease forwards; }
  @keyframes travel { from { left:-2px; opacity:1; } to { left:calc(100% - 8px); opacity:.1; } }
  .cable .pulse.rtl { animation-name:travelr; }
  @keyframes travelr { from { left:calc(100% - 8px); opacity:1; } to { left:-2px; opacity:.1; } }
  .msg.left { border-left:3px solid var(--golddim); }
  .msg.right { border-left:3px solid var(--line2); background:#100e0b; }
  .msg.accept { border-left-color:var(--ok); }
  .msg.reject { border-left-color:var(--no); }
  .msghead { display:flex; gap:12px; align-items:baseline; }
  .msg .from { color:var(--gold); font-weight:500; }
  .msg .kind { color:var(--dim); font-size:10px; letter-spacing:.2em; border:1px solid var(--line2);
               border-radius:999px; padding:2px 9px; }
  .msg.accept .kind { color:var(--ok); border-color:var(--okdim); }
  .msg.reject .kind { color:var(--no); border-color:var(--no); }
  .msg .at { color:var(--faint); font-size:11px; margin-left:auto; font-family:var(--mono); }
  .msgbody { margin-top:8px; }
  .offer-title { font-family:var(--serif); font-size:17px; }
  .chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:8px; }
  .chip { border:1px solid var(--line2); background:#131009; color:var(--text); padding:3px 11px;
          font-size:11.5px; border-radius:999px; text-decoration:none; }
  .chip.price { border-color:var(--golddim); color:var(--gold2); }
  .chip.place { color:var(--dim); }
  .chip.unverified { border-color:#7a5c1e; color:#c9a45a; font-style:italic; }
  .chip.source { border-color:var(--okdim); color:var(--ok); }
  .chip.committed { border-color:var(--ok); color:var(--ok); letter-spacing:.16em; }
  .reason { color:var(--dim); font-size:12.5px; margin-top:8px; max-width:72ch; line-height:1.65; }
  .reason.terms { font-family:var(--serif); font-style:italic; color:var(--text); }
  .raw { margin-top:8px; }
  .raw summary { color:var(--faint); font-size:10px; cursor:pointer; letter-spacing:.1em; }
  .raw code { display:block; color:var(--dim); font-size:11px; overflow-wrap:anywhere; padding:6px 0 0;
              font-family:var(--mono); }

  /* the seal */
  .seal { margin:6px 32px 30px; border:1px solid var(--okdim); border-radius:12px; padding:24px;
          display:flex; gap:26px; align-items:center; flex-wrap:wrap;
          background:radial-gradient(600px 200px at 20% 50%, rgba(126,203,143,.06), transparent), var(--ink2); }
  .wax { width:130px; height:130px; border-radius:50%; border:3px double var(--ok); flex:none;
         display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
         color:var(--ok); transform:rotate(-6deg); animation:stamp .5s cubic-bezier(.2,2,.4,1) both;
         box-shadow:0 0 34px rgba(126,203,143,.14); }
  @keyframes stamp { from { transform:rotate(-6deg) scale(1.6); opacity:0; } }
  .wax span { font-size:8.5px; letter-spacing:.34em; }
  .wax b { font-family:var(--serif); font-size:21px; letter-spacing:.24em; }
  .sealhead { font-family:var(--serif); font-size:21px; }
  .sealline { color:var(--dim); font-size:12.5px; margin-top:5px; }
  .sealhash { color:var(--faint); font-size:11px; margin-top:9px; }
  .sealhash code { color:var(--dim); font-family:var(--mono); overflow-wrap:anywhere; }
  .sealactions { margin-top:14px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  .btn { background:var(--gold); color:var(--ink); text-decoration:none; font-weight:600;
         letter-spacing:.12em; font-size:12px; padding:10px 18px; border-radius:8px; }
  .btn:hover { background:var(--gold2); }
  .mailnote { color:var(--ok); font-size:12px; }

  footer { color:var(--faint); font-size:11px; padding:0 32px 26px; letter-spacing:.05em; line-height:1.7; }
  @media (max-width:760px) {
    .lines { flex-direction:column; gap:10px; }
    .cable { width:100%; height:44px; }
    .gate { margin:16px; } .wire, .seal { margin:16px; } .lines { padding:16px 16px 0; }
  }
</style></head>
<body>
${dust(26)}
<header>
  <span class="brand"><a href="/">SPONDE</a></span>
  <span class="topic">${esc(room.topic)}</span>
  <span class="hright">
    <a class="hlink" href="/how">HOW&nbsp;IT&nbsp;WORKS</a>
    <span class="status ${esc(room.status)} ${room.status === 'negotiating' ? 'live' : ''}">${esc(statusLabel)}</span>
  </span>
</header>
${ticker}
${gateBanner}
<div class="lines">
  <div class="jack">
    <div class="label">LINE 1</div>
    <div class="who"><div class="mono">${esc(monogram(left))}</div>
      <div class="handle">${esc(left)}</div></div>
    ${jackStatus(board?.for(left, room.id), room.status)}
    ${keyState(left)}
  </div>
  <div class="cable">
    <span class="clabel">${connected ? '● CONNECTED' : '○ WAITING'}</span>
    <div class="wiremask"></div>
    <div style="width:100%;overflow:hidden"><div class="wireline"></div></div>
    <span class="keys">${keys} / 2 KEYS</span>
  </div>
  <div class="jack">
    <div class="label">LINE 2</div>
    <div class="who"><div class="mono">${esc(monogram(right))}</div>
      <div class="handle">${esc(right)}</div></div>
    ${jackStatus(board?.for(right, room.id), room.status)}
    ${connected ? keyState(right) : ''}
  </div>
</div>
<div class="wire" data-lastseq="${lastSeq}" data-lastside="${lastMsg && lastMsg.from !== left ? 'right' : 'left'}">
  <h2>ON THE WIRE — ONLY VALIDATED OFFER FIELDS CROSS · RAW CONSTRAINTS HAVE NO CHANNEL</h2>
  ${rows || '<div class="msg"><span class="reason">silence on the line…</span></div>'}
</div>
${sealBlock}
<footer>read-only operator view · every commit above passed a human approval gate in TrueForge · the room keeps no credentials</footer>
${poll}
</body></html>`;
}

/* ----------------------------------------------------------- index page */

const STEPS = [
  {
    n: '01',
    t: 'They meet in the room',
    d: 'Two TrueForge agents — one working for each human — connect to a neutral wire. Give them a job in one sentence.',
  },
  {
    n: '02',
    t: 'Only offers cross',
    d: 'The wire enforces a strict offer schema. Budgets, allergies, price floors — raw private constraints have no channel.',
  },
  {
    n: '03',
    t: 'Two keys, then it is real',
    d: 'Nothing binds until BOTH humans approve identical terms at their own gate. Then: a sealed receipt and a real calendar invite, exactly once.',
  },
];

export function renderIndexPage(rooms: Room[], board?: ActivityBoard, driverRunning = false): string {
  const statusChip: Record<string, string> = {
    open: 'chip-open',
    negotiating: 'chip-live',
    sealed: 'chip-sealed',
    abandoned: 'chip-dead',
  };
  const rows = rooms
    .map(
      (r) => `<a class="room" href="/room/${esc(r.id)}">
        <div class="room-top"><span class="rid">${esc(r.id)}</span>
          <span class="rstatus ${statusChip[r.status] ?? ''}">${esc(r.status.toUpperCase())}</span></div>
        <div class="rtopic">${esc(r.topic)}</div>
        <div class="rwho">${esc([...r.participants.keys()].join('  ⇄  ') || 'awaiting parties')}</div>
      </a>`,
    )
    .reverse()
    .join('\n');

  const activity = (board?.all() ?? [])
    .map((a) => {
      const waiting = a.state === 'awaiting_human';
      const dot = waiting ? 'gold' : a.state === 'done' ? 'ok' : a.state === 'idle' ? 'off' : 'live';
      return `<div class="duty">
        <span class="dot ${dot}"></span>
        <span class="dname">${esc(a.agent)}</span>
        <span class="dstate${waiting ? ' hot' : ''}">${esc(STATE_LABEL[a.state] ?? a.state)}${
          a.detail ? esc(` — ${a.detail}`) : ''
        }</span>
        <span class="dat">${esc(a.at.slice(11, 19))}</span>
      </div>`;
    })
    .join('\n');

  const startForm = driverRunning
    ? `<div class="startbox running">A negotiation is on the wire — open its room below to watch it live.</div>`
    : `<form class="startbox" method="post" action="/start">
        <input name="task" placeholder="book dinner for Abhinav and Priya this weekend…" autofocus autocomplete="off" />
        <button type="submit">CONNECT THE LINES</button>
       </form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sponde · the two-key deal room</title>
${FONTS}
<style>
${TOKENS}
  body { background:
    radial-gradient(1300px 620px at 50% -14%, #1c160c 0%, transparent 62%), var(--ink); }
  nav { padding:20px 34px; display:flex; justify-content:space-between; align-items:center; }
  .brand { font-family:var(--serif); font-weight:600; font-size:19px; letter-spacing:.32em; color:var(--gold); }
  .hlink { color:var(--dim); font-size:11px; letter-spacing:.22em; text-decoration:none; }
  .hlink:hover { color:var(--gold); }

  .hero { max-width:860px; margin:0 auto; padding:52px 26px 8px; text-align:center; }
  .hero h1 { font-family:var(--serif); font-weight:390; font-size:clamp(34px, 6vw, 58px);
             line-height:1.12; margin:0; letter-spacing:.005em; }
  .hero h1 em { font-style:italic; color:var(--gold2); }
  .hero p.sub { color:var(--dim); font-size:15px; line-height:1.75; max-width:58ch; margin:20px auto 0; }
  .hero p.sub b { color:var(--text); font-weight:500; }

  .startbox { display:flex; gap:0; max-width:760px; margin:34px auto 0;
              border:1px solid var(--line2); border-radius:12px; overflow:hidden;
              background:var(--panel); box-shadow:0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(217,164,65,.06); }
  .startbox:focus-within { border-color:var(--golddim); box-shadow:0 20px 60px rgba(0,0,0,.5), 0 0 30px rgba(217,164,65,.14); }
  .startbox input { flex:1; background:transparent; border:0; color:var(--text); padding:19px 22px;
    font-family:var(--sans); font-size:15.5px; min-width:0; }
  .startbox input::placeholder { color:var(--faint); }
  .startbox input:focus { outline:none; }
  .startbox button { background:var(--gold); border:0; color:var(--ink); font-family:var(--sans);
    font-weight:600; letter-spacing:.14em; font-size:12.5px; padding:0 26px; cursor:pointer; }
  .startbox button:hover { background:var(--gold2); }
  .startbox.running { color:var(--gold); border-style:dashed; padding:18px 22px; font-size:13.5px;
    letter-spacing:.04em; justify-content:center; box-shadow:none; }
  .hint { text-align:center; color:var(--faint); font-size:11px; letter-spacing:.16em; margin-top:14px; }

  .steps { display:flex; gap:14px; max-width:980px; margin:54px auto 0; padding:0 26px; }
  .step { flex:1; border:1px solid var(--line); border-radius:12px; padding:20px 22px;
          background:linear-gradient(180deg, var(--panel), transparent); }
  .step .n { font-family:var(--serif); color:var(--golddim); font-size:15px; font-style:italic; }
  .step .t { font-family:var(--serif); font-size:18.5px; margin-top:8px; }
  .step .d { color:var(--dim); font-size:12.5px; line-height:1.7; margin-top:8px; }

  section { max-width:980px; margin:0 auto; padding:0 26px; }
  h2 { margin:52px 0 14px; font-size:10.5px; letter-spacing:.3em; color:var(--faint); font-weight:400; }
  .duty { display:flex; gap:12px; align-items:baseline; padding:11px 16px; font-size:13px;
          border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--ink2); }
  .duty .dot { align-self:center; }
  .dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .dot.live { background:var(--gold); animation:pulse 1.4s ease-in-out infinite; }
  .dot.gold { background:var(--gold); animation:pulse .8s ease-in-out infinite; }
  .dot.ok { background:var(--ok); } .dot.off { background:var(--faint); }
  @keyframes pulse { 50% { opacity:.25; } }
  .dname { color:var(--gold); font-weight:500; min-width:190px; }
  .dstate { color:var(--dim); flex:1; }
  .dstate.hot { color:var(--gold); }
  .dat { color:var(--faint); font-size:11px; font-family:var(--mono); }

  .roomgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;
              padding-bottom:60px; }
  .room { border:1px solid var(--line); border-radius:12px; padding:16px 18px; text-decoration:none;
          color:var(--text); background:var(--ink2); transition:border-color .15s, transform .15s; }
  .room:hover { border-color:var(--golddim); transform:translateY(-2px); }
  .room-top { display:flex; justify-content:space-between; align-items:baseline; }
  .rid { color:var(--faint); font-size:11px; font-family:var(--mono); }
  .rstatus { font-size:9.5px; letter-spacing:.22em; padding:3px 9px; border-radius:999px; border:1px solid var(--line2); color:var(--dim); }
  .chip-live { border-color:var(--golddim); color:var(--gold); animation:pulse 2s ease-in-out infinite; }
  .chip-sealed { border-color:var(--okdim); color:var(--ok); }
  .chip-dead { color:var(--no); border-color:var(--no); opacity:.7; }
  .rtopic { font-family:var(--serif); font-size:16.5px; margin-top:10px; line-height:1.35; }
  .rwho { color:var(--dim); font-size:12px; margin-top:8px; }
  .empty { color:var(--faint); font-size:13px; padding:6px 2px 60px; }

  footer { border-top:1px solid var(--line); color:var(--faint); font-size:11px; letter-spacing:.06em;
           padding:20px 34px 26px; text-align:center; line-height:1.8; }
  @media (max-width:760px) { .steps { flex-direction:column; } .dname { min-width:0; } }
</style>
</head><body>
${dust(38)}
<nav><span class="brand">SPONDE</span><a class="hlink" href="/how">HOW IT WORKS →</a></nav>
<div class="hero">
  <h1>My agent will talk<br/>to <em>your</em> agent.</h1>
  <p class="sub">Sponde is the room where two personal AI agents meet and make a deal.
     Each knows only its own human's private world. Only validated offers cross the wire —
     and <b>nothing becomes real until both humans turn their key.</b></p>
  ${startForm}
  ${driverRunning ? '' : '<div class="hint">ONE SENTENCE · TWO AGENTS · TWO KEYS</div>'}
</div>
<div class="steps">
  ${STEPS.map((s) => `<div class="step"><div class="n">${s.n}</div><div class="t">${s.t}</div><div class="d">${s.d}</div></div>`).join('\n')}
</div>
<section>
  <h2>AGENTS ON DUTY — DOING · WAITING ON · DID</h2>
  ${activity || '<div class="empty">No agents reporting yet — give them a job above.</div>'}
</section>
<section>
  <h2>LINES</h2>
  <div class="roomgrid">${rows || '<div class="empty">No lines connected yet.</div>'}</div>
</section>
<footer>every sealed line above required two human approvals · the room holds no credentials and binds to this machine only<br/>
built on TrueForge · minds by OpenAI · reviewed by Qodo · grounded by Bright Data</footer>
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
