import { describe, expect, it, vi } from 'vitest';
import { context, reddit, redis } from '@devvit/web/server';
import type { OnCommentCreateRequest, T1 } from '@devvit/web/shared';
import { createApp } from './app';
import { articleUrl, truncate } from './define-command';
import { createModTest, type FakeRedditWorld } from './test-harness';

const GEMINI_PRIMARY = 'gemini-2.5-flash-lite:generateContent';
const GEMINI_FALLBACK = 'gemini-3.1-flash-lite:generateContent';

type Call = { url: string; body?: Record<string, unknown>; headers: Record<string, string> };
type Responder = (call: Call) => Response;

const geminiSays = (text: string) =>
  Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const wikiPage = (title: string, extract: string) =>
  Response.json({ query: { pages: { '42': { pageid: 42, title, extract } } } });
const wikiMissing = () =>
  Response.json({ query: { pages: { '-1': { pageid: 0, title: 'X', missing: '' } } } });

/**
 * Comment.reply is unimplemented in `@devvit/test`, so route it through
 * FakeRedditWorld's submitComment spy. Gemini and Wikipedia are faked with a
 * spied fetch; nothing leaves the process.
 */
function install(world: FakeRedditWorld, respond: Responder) {
  const calls: Call[] = [];
  vi.spyOn(reddit, 'getCommentById').mockImplementation((async (id: T1) => ({
    id,
    reply: (opts: { text: string }) => reddit.submitComment({ id, text: opts.text }),
  })) as unknown as typeof reddit.getCommentById);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const call: Call = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  });
  void world;
  return calls;
}

/** Default fake: Gemini resolves "spin" to "Spin (physics)"; Wikipedia returns its intro. */
const happyPath: Responder = ({ url }) => {
  if (url.includes(GEMINI_PRIMARY)) return geminiSays('Spin (physics)\n');
  if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
    return wikiPage('Spin (physics)', 'Spin is an intrinsic form of angular momentum.');
  }
  throw new Error(`unexpected fetch ${url}`);
};

const test = createModTest({
  appFactory: createApp,
  settings: {
    geminiApiKey: 'gemini-key',
    defineCommandCategory: 'physics',
    botSignature: 'I am a bot.',
  },
});

const mention = () => `u/${context.appSlug}`;
const commentEvent = (id: T1, body: string) =>
  ({
    type: 'CommentCreate',
    post: { id: 't3_post' },
    comment: { id, postId: 't3_post', body, author: 'alice' },
    author: { id: 't2_alice', name: 'alice' },
  }) as unknown as OnCommentCreateRequest;

describe('reply helpers', () => {
  it('builds Wikipedia article URLs with underscores and encoding', () => {
    expect(articleUrl('Spin (physics)')).toBe('https://en.wikipedia.org/wiki/Spin_(physics)');
    expect(articleUrl('Schrödinger equation')).toBe(
      'https://en.wikipedia.org/wiki/Schr%C3%B6dinger_equation'
    );
  });

  it('keeps short extracts and cuts long ones at a sentence boundary', () => {
    expect(truncate('Short.')).toBe('Short.');
    const long = `${'A'.repeat(400)}. ${'B'.repeat(400)}.`;
    expect(truncate(long)).toBe(`${'A'.repeat(400)}.`);
    const noStop = 'word '.repeat(200);
    expect(truncate(noStop).endsWith('…')).toBe(true);
    expect(truncate(noStop).length).toBeLessThanOrEqual(601);
  });
});

describe('!define', () => {
  test('replies with the resolved Wikipedia title, link and intro', async ({ world, runner }) => {
    const calls = install(world, happyPath);
    const id = 't1_q1' as T1;

    const res = await runner.trigger(
      'comment-create',
      commentEvent(id, `${mention()} !define [spin]`)
    );

    expect(res).toEqual({ status: 'ok' });
    const [reply] = world.commentsOn(id);
    expect(reply?.body).toBe(
      '**Spin (physics)**\n[Wikipedia](https://en.wikipedia.org/wiki/Spin_(physics))\n\n' +
        'Spin is an intrinsic form of angular momentum.\n\n---\n\n^I ^am ^a ^bot.'
    );
    const gemini = calls[0]!;
    expect(gemini.url).toContain(GEMINI_PRIMARY);
    expect(gemini.headers['x-goog-api-key']).toBe('gemini-key');
    expect(JSON.stringify(gemini.body)).toContain('Term: spin');
    expect(JSON.stringify(gemini.body)).toContain('physics subreddit');
    expect(gemini.body?.tools).toEqual([{ google_search: {} }]);
    const wiki = new URL(calls[1]!.url);
    expect(wiki.searchParams.get('titles')).toBe('Spin (physics)');
    expect(calls[1]!.headers['User-Agent']).toBe(`${context.appSlug}/1.0 (Reddit bot)`);
  });

  test('ignores comments that do not mention the app account', async ({ world, runner }) => {
    const calls = install(world, happyPath);

    await runner.trigger('comment-create', commentEvent('t1_q2' as T1, '!define [spin]'));

    expect(calls).toHaveLength(0);
    expect(world.commentsOn('t1_q2' as T1)).toHaveLength(0);
  });

  test('handles each comment once even if the trigger is redelivered', async ({
    world,
    runner,
  }) => {
    install(world, happyPath);
    const event = commentEvent('t1_q3' as T1, `${mention()} !define [spin]`);

    await runner.trigger('comment-create', event);
    await runner.trigger('comment-create', event);

    expect(world.commentsOn('t1_q3' as T1)).toHaveLength(1);
    expect(await redis.get('bot:cmd:t1_q3')).toBe('1');
  });

  test('ignores unknown commands and !define without a [term]', async ({ world, runner }) => {
    const calls = install(world, happyPath);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q4' as T1, `${mention()} !explain [x]`)
    );
    await runner.trigger('comment-create', commentEvent('t1_q5' as T1, `${mention()} !define`));

    expect(calls).toHaveLength(0);
    expect(world.comments).toHaveLength(0);
  });

  test('does nothing when disabled or when no Gemini key is configured', async ({
    world,
    runner,
    mocks,
  }) => {
    const calls = install(world, happyPath);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mocks.settings.update({ defineCommandEnabled: false });
    await runner.trigger(
      'comment-create',
      commentEvent('t1_q6' as T1, `${mention()} !define [spin]`)
    );
    mocks.settings.update({ defineCommandEnabled: true, geminiApiKey: '' });
    await runner.trigger(
      'comment-create',
      commentEvent('t1_q7' as T1, `${mention()} !define [spin]`)
    );

    expect(calls).toHaveLength(0);
    expect(world.comments).toHaveLength(0);
  });

  test('says so when Gemini rejects the term for the category', async ({ world, runner }) => {
    install(world, () => geminiSays('none'));

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q8' as T1, `${mention()} !define [pizza]`)
    );

    expect(world.commentsOn('t1_q8' as T1)[0]?.body).toMatch(
      /^"pizza" doesn't appear to be a physics concept\./
    );
  });

  test('omits the category clause and grounding when not configured', async ({
    world,
    runner,
    mocks,
  }) => {
    const calls = install(world, ({ url }) =>
      url.includes(GEMINI_PRIMARY) ? geminiSays('none') : wikiMissing()
    );
    mocks.settings.update({ defineCommandCategory: '', defineCommandSearchGrounding: false });

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q9' as T1, `${mention()} !define [foo]`)
    );

    expect(calls[0]?.body?.tools).toBeUndefined();
    expect(JSON.stringify(calls[0]?.body)).not.toContain('subreddit');
    expect(world.commentsOn('t1_q9' as T1)[0]?.body).toMatch(
      /^Couldn't find a Wikipedia article for "foo"\./
    );
  });

  test('reports a missing Wikipedia article for the resolved title', async ({ world, runner }) => {
    install(world, ({ url }) =>
      url.includes(GEMINI_PRIMARY) ? geminiSays('Made up') : wikiMissing()
    );

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q10' as T1, `${mention()} !define [x]`)
    );

    expect(world.commentsOn('t1_q10' as T1)[0]?.body).toMatch(
      /^Couldn't find a Wikipedia article for "Made up"\./
    );
  });

  test('falls back to the second Gemini model when the first is rate limited', async ({
    world,
    runner,
  }) => {
    const calls = install(world, (call) =>
      call.url.includes(GEMINI_PRIMARY)
        ? new Response('', { status: 429 })
        : call.url.includes(GEMINI_FALLBACK)
          ? geminiSays('Spin (physics)')
          : happyPath(call)
    );

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q11' as T1, `${mention()} !define [spin]`)
    );

    expect(calls.map((c) => c.url.split('/').pop()?.split('?')[0])).toEqual([
      GEMINI_PRIMARY.replace('models/', ''),
      GEMINI_FALLBACK.replace('models/', ''),
      'api.php',
    ]);
    expect(world.commentsOn('t1_q11' as T1)[0]?.body).toContain('**Spin (physics)**');
  });

  test('replies with a retry message when a lookup fails', async ({ world, runner }) => {
    install(world, () => new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q12' as T1, `${mention()} !define [spin]`)
    );

    expect(world.commentsOn('t1_q12' as T1)[0]?.body).toMatch(
      /^Failed to look up "spin" — please try again later\./
    );
  });

  test('strips stray punctuation from the term', async ({ world, runner }) => {
    const calls = install(world, happyPath);

    await runner.trigger(
      'comment-create',
      commentEvent('t1_q13' as T1, `${mention()} !define [ "spin". ]`)
    );

    expect(JSON.stringify(calls[0]?.body)).toContain('Term: spin');
  });
});
