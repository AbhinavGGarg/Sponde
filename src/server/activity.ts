/**
 * Live activity board — what each agent is DOING, what it is WAITING ON, and
 * whether an IRREVERSIBLE step is pending a human. The driver reports these
 * over loopback; the operator view renders them. Display state only: the
 * room store, not this board, is the source of truth for what happened.
 *
 * Entries are scoped per room (Qodo round 2, finding 3): two rooms that
 * happen to reuse a participant handle never see each other's status. A
 * report without a room_id is a global entry, shown only on the index.
 */

export type AgentState = 'idle' | 'negotiating' | 'waiting_reply' | 'awaiting_human' | 'done';

export interface AgentActivity {
  agent: string;
  state: AgentState;
  detail: string;
  at: string;
  room_id?: string;
}

export class ActivityBoard {
  private entries = new Map<string, AgentActivity>();

  private key(agent: string, roomId?: string): string {
    return `${roomId ?? ''}|${agent}`;
  }

  report(agent: string, state: AgentState, detail: string, roomId?: string): AgentActivity {
    const entry: AgentActivity = {
      agent,
      state,
      detail,
      at: new Date().toISOString(),
      ...(roomId ? { room_id: roomId } : {}),
    };
    this.entries.set(this.key(agent, roomId), entry);
    return entry;
  }

  all(): AgentActivity[] {
    return [...this.entries.values()];
  }

  /** Room pages read ONLY entries reported for that room — no global fallback. */
  for(agent: string, roomId: string): AgentActivity | undefined {
    return this.entries.get(this.key(agent, roomId));
  }

  pendingHuman(roomId?: string): AgentActivity[] {
    return this.all().filter(
      (a) => a.state === 'awaiting_human' && (roomId === undefined || a.room_id === roomId),
    );
  }
}
