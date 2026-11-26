import { describe, expect, it, vi } from 'vitest';
import { context, redis } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { createApp } from './app';
import { articleUrl, truncate } from './define-command';
import {
  createModTest,
  expectAllEndpointsCovered,
  type FakeHttp,
  type FakeRedditWorld,
} from './test-harness';

const GEMINI = 'generativelanguage.googleapis.com';
const WIKI = 'en.wikipedia.org';
const PRIMARY = 'gemini-2.5-flash-lite:generateContent';
const FALLBACK = 'gemini-3.1-flash-lite:generateContent';

const geminiSays = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const wikiPage = (title: string, extract: string) => ({
  query: { pages: { '42': { pageid: 42, title, extract } } },
});
const wikiMissing = { query: { pages: { '-1': { pageid: 0, title: 'X', missing: '' } } } };

/** Gemini resolves "spin" to "Spin (physics)"; Wikipedia returns its intro. */
function happyPath(http: FakeHttp) {
  http.json(GEMINI, geminiSays('Spin (physics)\n'), { path: (c) => c.path.endsWith(PRIMARY) });
  http.json(WIKI, wikiPage('Spin (physics)', 'Spin is an intrinsic form of angular momentum.'), {
    path: '/w/api.php',
  });
}

const test = createModTest({
  appFactory: createApp,
  settings: {
    geminiApiKey: 'gemini-key',
    defineCommandCategory: 'physics',
    botSignature: 'I am a bot.',
  },
});

const mention = () => `u/${context.appSlug}`;

/** A thread to comment in, and the user's `!define` comment through the real trigger. */
function thread(world: FakeRedditWorld): T3 {
  return world.seedPost({ id: 't3_post', title: 'Physics question', author: 'op' }).id;
}

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
  test('replies with the resolved Wikipedia title, link and intro', async ({
    world,
    runner,
    http,
  }) => {
    happyPath(http);
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [spin]`);

    expect(world.describeActions()).toEqual([
      `test-app comment ${q.id} id=t1_c2 "**Spin (physics)** [Wikipedia](https://en.wikipedia.org/w..."`,
    ]);
    expect(world.commentsOn(q.id)[0]?.body).toBe(
      '**Spin (physics)**\n[Wikipedia](https://en.wikipedia.org/wiki/Spin_(physics))\n\n' +
        'Spin is an intrinsic form of angular momentum.\n\n---\n\n^I ^am ^a ^bot.'
    );
    const [gemini] = http.callsTo(GEMINI);
    expect(gemini?.path).toContain(PRIMARY);
    expect(gemini?.headers['x-goog-api-key']).toBe('gemini-key');
    expect(gemini?.body).toContain('Term: spin');
    expect(gemini?.body).toContain('physics subreddit');
    expect((gemini?.json as { tools?: unknown }).tools).toEqual([{ google_search: {} }]);
    const [wiki] = http.callsTo(WIKI);
    expect(new URL(wiki!.url).searchParams.get('titles')).toBe('Spin (physics)');
    expect(wiki?.headers['user-agent']).toBe(`${context.appSlug}/1.0 (Reddit bot)`);
  });

  test('ignores comments that do not mention the app account', async ({ world, runner, http }) => {
    await runner.userComments('alice', thread(world), '!define [spin]');
    expect(http.calls).toHaveLength(0);
    expect(world.actions).toEqual([]);
  });

  test('handles each comment once even if the trigger is redelivered', async ({
    world,
    runner,
    http,
    events,
  }) => {
    happyPath(http);
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [spin]`);
    await runner.trigger('comment-create', events.commentCreate(q.id));

    expect(world.commentsOn(q.id)).toHaveLength(1);
    expect(await redis.get(`bot:cmd:${q.id}`)).toBe('1');
  });

  test('ignores unknown commands and !define without a [term]', async ({ world, runner, http }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = thread(world);
    await runner.userComments('alice', post, `${mention()} !explain [x]`);
    await runner.userComments('alice', post, `${mention()} !define`);

    expect(http.calls).toHaveLength(0);
    expect(world.actions).toEqual([]);
  });

  test('does nothing when disabled or when no Gemini key is configured', async ({
    world,
    runner,
    http,
    configure,
  }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = thread(world);
    configure({ defineCommandEnabled: false });
    await runner.userComments('alice', post, `${mention()} !define [spin]`);
    configure({ defineCommandEnabled: true, geminiApiKey: '' });
    await runner.userComments('alice', post, `${mention()} !define [spin]`);

    expect(http.calls).toHaveLength(0);
    expect(world.actions).toEqual([]);
  });

  test('says so when Gemini rejects the term for the category', async ({ world, runner, http }) => {
    http.json(GEMINI, geminiSays('none'));
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [pizza]`);

    expect(world.commentsOn(q.id)[0]?.body).toMatch(
      /^"pizza" doesn't appear to be a physics concept\./
    );
  });

  test('omits the category clause and grounding when not configured', async ({
    world,
    runner,
    http,
    configure,
  }) => {
    http.json(GEMINI, geminiSays('none'));
    configure({ defineCommandCategory: '', defineCommandSearchGrounding: false });
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [foo]`);

    const [gemini] = http.callsTo(GEMINI);
    expect((gemini?.json as { tools?: unknown }).tools).toBeUndefined();
    expect(gemini?.body).not.toContain('subreddit');
    expect(world.commentsOn(q.id)[0]?.body).toMatch(
      /^Couldn't find a Wikipedia article for "foo"\./
    );
  });

  test('reports a missing Wikipedia article for the resolved title', async ({
    world,
    runner,
    http,
  }) => {
    http.json(GEMINI, geminiSays('Made up'));
    http.json(WIKI, wikiMissing);
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [x]`);

    expect(world.commentsOn(q.id)[0]?.body).toMatch(
      /^Couldn't find a Wikipedia article for "Made up"\./
    );
  });

  test('falls back to the second Gemini model when the first is rate limited', async ({
    world,
    runner,
    http,
  }) => {
    happyPath(http);
    http.stub(GEMINI, () => new Response('', { status: 429 }), {
      path: (c) => c.path.endsWith(PRIMARY),
    });
    http.json(GEMINI, geminiSays('Spin (physics)'), { path: (c) => c.path.endsWith(FALLBACK) });
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [spin]`);

    expect(http.calls.map((c) => c.path.split('/').pop())).toEqual([PRIMARY, FALLBACK, 'api.php']);
    expect(world.commentsOn(q.id)[0]?.body).toContain('**Spin (physics)**');
  });

  test('replies with a retry message when a lookup fails', async ({ world, runner, http }) => {
    http.stub(GEMINI, () => new Response('', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const q = await runner.userComments('alice', thread(world), `${mention()} !define [spin]`);

    expect(world.commentsOn(q.id)[0]?.body).toMatch(
      /^Failed to look up "spin" — please try again later\./
    );
  });

  test('strips stray punctuation from the term', async ({ world, runner, http }) => {
    happyPath(http);
    await runner.userComments('alice', thread(world), `${mention()} !define [ "spin". ]`);
    expect(http.callsTo(GEMINI)[0]?.body).toContain('Term: spin');
  });

  test('still answers in a locked thread (the app account is a moderator)', async ({
    world,
    runner,
    http,
  }) => {
    // The app account is a moderator, so it can still answer in locked threads.
    happyPath(http);
    const post = world.seedPost({ title: 'locked', locked: true });
    const q = world.seedComment({
      parentId: post.id,
      body: `${mention()} !define [spin]`,
      author: 'mod',
    });
    world.mod('mod');
    await runner.trigger('comment-create', runner.events!.commentCreate(q.id));
    expect(world.commentsOn(q.id)).toHaveLength(1);
  });

  // Keep last.
  test('every devvit.json endpoint has a scenario', () => {
    expectAllEndpointsCovered();
  });
});
