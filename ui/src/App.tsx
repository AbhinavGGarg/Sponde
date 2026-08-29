import { TrueForgeUI } from '@truefoundry/trueforge-ui';

/**
 * The war room — one screen a stranger can drive.
 *
 * Left and right: the REAL TrueForge chat, embedded via @truefoundry/trueforge-ui,
 * pinned to one agent per pane. The approval cards that gate commit_deal render
 * here, live — each human turns their key in their own pane.
 * Center: the switchboard wire (the operator view served by our room server).
 *
 * TrueForge is reached same-origin through the Vite proxy (/api → :8790), so
 * no CORS and no credentials in the browser beyond TrueForge's own session.
 */

const SWITCHBOARD_URL = 'http://localhost:7400';

const theme = {
  mode: 'dark' as const,
  brand: { name: 'SPONDE' },
};

function Pane(props: { agent: string; human: string }) {
  return (
    <section style={styles.pane}>
      <header style={styles.paneHeader}>
        <span style={styles.paneLabel}>{props.human}&rsquo;S LINE</span>
        <span style={styles.paneAgent}>{props.agent}</span>
      </header>
      <div style={styles.paneBody}>
        <TrueForgeUI
          server={{ type: 'trueforge', baseUrl: '/' }}
          layout="widget"
          agentConfig={{ mode: 'SingleAgent', name: props.agent }}
          theme={theme}
        />
      </div>
    </section>
  );
}

export function App() {
  return (
    <div style={styles.shell}>
      <header style={styles.top}>
        <span style={styles.brand}>SPONDE</span>
        <span style={styles.tag}>the two-key deal room — my agent will talk to your agent</span>
        <a style={styles.link} href={`${SWITCHBOARD_URL}/how`} target="_blank" rel="noreferrer">
          HOW IT WORKS →
        </a>
      </header>
      <main style={styles.columns}>
        <Pane agent="switchboard-abhinav" human="ABHINAV" />
        <section style={styles.wire}>
          <iframe title="the wire" src={SWITCHBOARD_URL} style={styles.iframe} />
        </section>
        <Pane agent="switchboard-priya" human="PRIYA" />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    background: '#0d0c0a',
    color: '#efe7da',
    fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, monospace",
  },
  top: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 18,
    padding: '14px 20px',
    borderBottom: '1px solid #2a241f',
  },
  brand: { letterSpacing: '.35em', fontWeight: 700, color: '#e0a93e' },
  tag: { color: '#8d8272', fontSize: 12, flex: 1 },
  link: { color: '#8d8272', fontSize: 11, letterSpacing: '.2em', textDecoration: 'none' },
  columns: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 1fr) minmax(420px, 1.2fr) minmax(320px, 1fr)',
    minHeight: 0,
  },
  pane: { display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid #2a241f' },
  paneHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 14px',
    borderBottom: '1px solid #2a241f',
    fontSize: 11,
    letterSpacing: '.2em',
  },
  paneLabel: { color: '#e0a93e' },
  paneAgent: { color: '#8d8272' },
  paneBody: { flex: 1, minHeight: 0 },
  wire: { minWidth: 0, borderRight: '1px solid #2a241f', display: 'flex' },
  iframe: { border: 0, width: '100%', height: '100%' },
};
