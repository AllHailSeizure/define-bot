import { context, redis } from '@devvit/web/server';
import type { OnCommentCreateRequest, OnPostSubmitRequest } from '@devvit/web/shared';
import { logger } from './helpers/logger';

// ─── Command types ─────────────────────────────────────────────────────────────

export type ContentType = 'comment' | 'post' | 'both';

export interface CommandDefinition {
  commandName: string;
  contentType: ContentType;
  requiresArgument: boolean;
}

export type CommandEvent = OnCommentCreateRequest | OnPostSubmitRequest;
export type CommandHandler = (event: CommandEvent, argument: string | null) => Promise<void>;

export interface RegisteredCommand {
  definition: CommandDefinition;
  handler: CommandHandler;
}

const log = logger('command');

const commands = new Map<string, RegisteredCommand>();

export function registerCommand(definition: CommandDefinition, handler: CommandHandler): void {
  if (commands.has(definition.commandName)) {
    log.warn(`Duplicate command registration: ${definition.commandName}`);
  }
  commands.set(definition.commandName, { definition, handler });
}

const COMMAND_PATTERN = /!(\w+)(?:\s+\\?\[([^\]]+)\\?\])?/g;

async function parseAndDispatch(
  body: string,
  contentType: 'comment' | 'post',
  event: CommandEvent,
): Promise<void> {
  const botMention = `u/${context.appSlug}`;
  if (!body.toLowerCase().includes(botMention.toLowerCase())) return;

  const matches = [...body.matchAll(COMMAND_PATTERN)];
  if (matches.length === 0) return;

  // Guard against duplicate command dispatch on the same content (handles platform retry delivery)
  const contentId =
    contentType === 'comment' && 'comment' in event ? event.comment?.id : event.post?.id;
  if (contentId) {
    const claimed = await redis.set(`bot:cmd:${contentId}`, '1', { nx: true });
    if (!claimed) return; // duplicate trigger delivery on same comment/post
    await redis.expire(`bot:cmd:${contentId}`, 3600);
  }

  for (const [, commandName, rawArgument] of matches) {
    if (!commandName) continue;
    const argument = rawArgument?.replace(/^[^a-zA-Z0-9()]+|[^a-zA-Z0-9()]+$/g, '');
    const registered = commands.get(commandName);
    if (!registered) {
      const argPart = argument ? `, Argument: [${argument}]` : '';
      log.info(`Unknown command: !${commandName}${argPart}`);
      continue;
    }

    const { definition, handler } = registered;

    if (definition.contentType !== 'both' && definition.contentType !== contentType) {
      log.info(`Command !${commandName} not allowed in ${contentType}`);
      continue;
    }

    if (definition.requiresArgument && (argument === null || argument === undefined)) {
      log.warn(`Command !${commandName} requires an argument, none provided`);
      continue;
    }

    const arg = definition.requiresArgument ? argument! : null;
    log.info(`Dispatching command: !${commandName}`, { contentType, arg });
    await handler(event, arg);
  }
}

export const runOnComment = async (event: OnCommentCreateRequest): Promise<void> => {
  await parseAndDispatch(event.comment?.body ?? '', 'comment', event);
};

export const runOnPost = async (event: OnPostSubmitRequest): Promise<void> => {
  log.info('runOnPost called', { postId: event.post?.id });
  const text = `${event.post?.title ?? ''} ${event.post?.selftext ?? ''}`;
  await parseAndDispatch(text, 'post', event);
};
