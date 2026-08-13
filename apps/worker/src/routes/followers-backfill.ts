import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';

const followersBackfill = new Hono<Env>();

/**
 * Webhook 設置前から友だちだったユーザーを friends に取り込む。
 *
 * 背景: friends に入るのは webhook を受けた友だちだけなので、webhook を繋ぐ前に
 * 追加済みだった人は DB に存在しない。結果 DB 件数と LINE の実友だち数が大きく
 * 乖離し、セグメント配信の到達数が実態と合わなくなる。
 *
 * 動作: LINE の GET /v2/bot/followers/ids で友だちの userId を 300 件ずつ取得し、
 * friends に無い userId だけを getProfile して INSERT する。
 * ?continuationToken で次ページへ進む。next が返らなくなったら完了。
 *
 * 重要 — 既存 friend 行は一切更新しない:
 * friends.line_user_id は UNIQUE で、1人につき全アカウント通して1行しか持てない。
 * 同じ人が複数の公式アカウントを友だち追加している場合、既存行を更新すると
 * line_account_id が後勝ちで別アカウントへ付け替わり、今の所属が壊れる。
 * バックフィルは「DB に居ない人を足すだけ」に限定する。
 *
 * 認証: 全ルート共通の authMiddleware（APIトークン必須）配下。取得と INSERT のみで
 * 送信も削除もしないため、profile-refresh と同じく role guard は付けない。
 */
followersBackfill.post('/api/admin/backfill-followers', async (c) => {
  const accountId = c.req.query('accountId');
  const continuationToken = c.req.query('continuationToken') ?? undefined;
  const dryRun = c.req.query('dryRun') === '1';

  // アカウントは必須。既定アカウントへの暗黙フォールバックはしない
  // （複数アカウント運用で、意図しないアカウントに数百件流し込む事故を防ぐ）。
  if (!accountId) {
    return c.json({ success: false, error: 'accountId is required' }, 400);
  }

  const db = c.env.DB;

  const account = await db
    .prepare('SELECT id, name, channel_access_token FROM line_accounts WHERE id = ?')
    .bind(accountId)
    .first<{ id: string; name: string; channel_access_token: string }>();

  if (!account) {
    return c.json({ success: false, error: 'account not found' }, 404);
  }

  const client = new LineClient(account.channel_access_token);

  let page: { userIds: string[]; next?: string };
  try {
    page = await client.getFollowerIds(continuationToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 403 = 未認証アカウント。このAPIは認証済み/プレミアムアカウント限定。
    if (msg.includes('403')) {
      return c.json(
        {
          success: false,
          error:
            'follower ids unavailable for this account (verified/premium accounts only)',
          detail: msg,
        },
        403,
      );
    }
    console.error('[backfill-followers] getFollowerIds failed:', msg);
    return c.json({ success: false, error: 'failed to fetch follower ids' }, 502);
  }

  const fetched = page.userIds.length;

  // 既知の userId を除外。D1 のバインド変数上限を避けるため 100 件ずつ問い合わせる。
  const known = new Set<string>();
  for (let i = 0; i < page.userIds.length; i += 100) {
    const chunk = page.userIds.slice(i, i + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT line_user_id FROM friends WHERE line_user_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ line_user_id: string }>();
    for (const row of rows.results ?? []) known.add(row.line_user_id);
  }

  const unknown = page.userIds.filter((id) => !known.has(id));

  if (dryRun) {
    return c.json({
      success: true,
      data: {
        dryRun: true,
        account: account.name,
        fetched,
        alreadyKnown: known.size,
        wouldInsert: unknown.length,
        next: page.next ?? null,
        hasMore: Boolean(page.next),
      },
    });
  }

  // profile-refresh.ts と同じ並列度。LINE 側の rate limit は緩い (~2000 req/sec)。
  const CONCURRENCY = 50;
  let inserted = 0;
  let profileFailed = 0;
  let insertFailed = 0;

  for (let i = 0; i < unknown.length; i += CONCURRENCY) {
    const chunk = unknown.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (lineUserId) => {
        let displayName: string | null = null;
        let pictureUrl: string | null = null;
        let statusMessage: string | null = null;

        try {
          const profile = await client.getProfile(lineUserId);
          displayName = profile.displayName ?? null;
          pictureUrl = profile.pictureUrl ?? null;
          statusMessage = profile.statusMessage ?? null;
        } catch (err) {
          // プロフィール取得に失敗しても、followers/ids に載っている時点で
          // 友だちであることは確定している。名前なしでも登録して配信対象に含める。
          profileFailed += 1;
          console.error('[backfill-followers] getProfile failed', lineUserId, err);
        }

        try {
          await db
            .prepare(
              `INSERT INTO friends
                 (id, line_user_id, display_name, picture_url, status_message,
                  is_following, line_account_id, metadata, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?,
                       strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') || '+09:00',
                       strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') || '+09:00')
               ON CONFLICT(line_user_id) DO NOTHING`,
            )
            .bind(
              crypto.randomUUID(),
              lineUserId,
              displayName,
              pictureUrl,
              statusMessage,
              account.id,
              // 実際に友だち追加された日時は LINE から取得できないため
              // first_followed_at 等は NULL のまま。取込であることを記録しておく。
              JSON.stringify({ source: 'followers_backfill' }),
            )
            .run();
          inserted += 1;
        } catch (err) {
          insertFailed += 1;
          console.error('[backfill-followers] insert failed', lineUserId, err);
        }
      }),
    );
  }

  return c.json({
    success: true,
    data: {
      account: account.name,
      fetched,
      alreadyKnown: known.size,
      inserted,
      profileFailed,
      insertFailed,
      next: page.next ?? null,
      hasMore: Boolean(page.next),
    },
  });
});

export { followersBackfill };
