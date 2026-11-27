# Contributing

Thanks for helping improve **define-bot**. End users and moderators should read [README.md](README.md).

## Issues

Use [GitHub Issues](https://github.com/AllHailSeizure/define-bot/issues) to report bugs or suggest improvements. Include steps to reproduce, the subreddit context (if relevant), and what you expected the bot to do.

## Pull requests

1. Fork the repository.
2. Create a branch from **`master`**.
3. Make focused changes with clear commit messages.
4. Open a pull request targeting **`master`**.

Maintainers review PRs and may ask for changes before merge.

## Code style

- Application code lives under **`src/server/`** (TypeScript).
- Run **`npm run lint`** before you open a PR (ESLint — see `eslint.config.mjs`).
- Use **`npm run format`** for Prettier formatting (see `.prettierrc`).
- Match the style of the files you edit (naming, imports, and structure).
- When you change behavior, add or update tests next to the code (for example `src/server/define-command.test.ts`).