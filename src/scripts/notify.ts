/**
 * Human notification fan-out. Terminal always; Slack when SLACK_WEBHOOK_URL is
 * set (any Slack "incoming webhook" URL works). Swap in PagerDuty/Twilio here
 * for production — the interface stays the same.
 */

export type NotifyKind = 'alert' | 'approval_needed' | 'postmortem' | 'resolved' | 'info';

const EMOJI: Record<NotifyKind, string> = {
  alert: '🚨',
  approval_needed: '🙋',
  postmortem: '📋',
  resolved: '✅',
  info: 'ℹ️',
};

export async function notify(kind: NotifyKind, message: string): Promise<void> {
  const line = `${EMOJI[kind]} [war-room] ${message}`;
  // Terminal bell so the demo audibly pings even without Slack configured.
  console.log(`${line}`);

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: line }),
    });
  } catch (err) {
    console.error('[watchtower] slack notification failed:', err);
  }
}
