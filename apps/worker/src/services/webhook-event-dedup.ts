// Dedup store for inbound LINE webhook events, keyed by LINE's own
// webhookEventId. Prevents redelivered events (LINE retries when our
// response isn't received in time) from re-running event handling —
// e.g. a redelivered `follow` event re-enrolling the friend_add scenario
// and double-sending the welcome message.

export interface ClaimWebhookEventParams {
  webhookEventId: string;
  eventType: string;
  ttlMinutes: number;
  now: Date;
}

// Returns true the first time this webhookEventId is seen (caller should
// process the event); false on a repeat (caller should skip it).
// Fails open on DB errors — a dedup outage must never block real messages.
export async function claimWebhookEvent(
  db: D1Database,
  params: ClaimWebhookEventParams,
): Promise<boolean> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  try {
    const result = await db
      .prepare(
        `INSERT INTO webhook_event_dedup (webhook_event_id, event_type, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(webhook_event_id) DO NOTHING`,
      )
      .bind(params.webhookEventId, params.eventType, expires)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error('[webhook-event-dedup] claim failed, processing anyway:', err);
    return true;
  }
}

export async function purgeExpiredWebhookEvents(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM webhook_event_dedup WHERE expires_at <= ?`)
    .bind(now.toISOString())
    .run();
  return result.meta?.changes ?? 0;
}
