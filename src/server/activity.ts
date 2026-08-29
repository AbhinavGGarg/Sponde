/**
 * Live activity board — what each agent is DOING, what it is WAITING ON, and
 * whether an IRREVERSIBLE step is pending a human. The driver reports these
 * over loopback; the operator view renders them. Display state only: the
 * room store, not this board, is the source of truth for what happened.
 */

export type AgentState = 'idle' | 'negotiating' | 'waiting_reply' | 'awaiting_human' | 'done';

export interface AgentActivity {
  agent: string;
  state: AgentState;
  detail: string;
  at: string;
}

export class ActivityBoard {
  private byAgent = new Map<string, AgentActivity>();

  report(agent: string, state: AgentState, detail: string): AgentActivity {
    const entry: AgentActivity = { agent, state, detail, at: new Date().toISOString() };
    this.byAgent.set(agent, entry);
    return entry;
  }

  all(): AgentActivity[] {
    return [...this.byAgent.values()];
  }

  for(agent: string): AgentActivity | undefined {
    return this.byAgent.get(agent);
  }

  pendingHuman(): AgentActivity[] {
    return this.all().filter((a) => a.state === 'awaiting_human');
  }
}
