import { Hono } from 'hono';
import type { OnCommentCreateRequest, TriggerResponse } from '@devvit/web/shared';
import { logger } from './helpers/logger';
import { runOnComment } from './command-helper';
// Side effect: registers the !define command with the command helper.
import './define-command';

const log = logger('app');

export function createApp(): Hono {
  const app = new Hono();

  app.post('/internal/triggers/comment-create', async (c) => {
    try {
      await runOnComment(await c.req.json<OnCommentCreateRequest>());
    } catch (err) {
      log.error('comment_create_failed', err);
    }
    return c.json<TriggerResponse>({ status: 'ok' });
  });

  return app;
}
