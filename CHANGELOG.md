# Changelog

All notable changes are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

### Contributors

- The type check no longer checks plain JavaScript packages in `node_modules`
  (`maxNodeModuleJsDepth: 0` in `jsconfig.json`). TypeScript 7 and `@types/node` 26 failed on
  `punycode`, a dependency of ESLint. Nothing changes for users of the plugin.
- The dev tools pin `qs` to 6.16.1 or later and `minimatch` to 11.0.1 or later through npm
  `overrides`; Stryker and ESLint pull them in transitively at versions with known advisories.
  Nothing changes for users of the plugin.
- CI runs the tests on Node.js 18 and the current LTS, ESLint, Prettier in check mode and a type
  check (`tsc --checkJs`) on every pull request and on `main`; a weekly Stryker run reports the
  mutation score. The dev tools are pinned in `package-lock.json` (Dependabot npm). The code was
  reformatted by Prettier; nothing changes for users of the plugin.
- One setup for all coding agents and people ([repo-kit](https://github.com/bullitt186/repo-kit)):
  `AGENTS.md` is the single instruction file (`CLAUDE.md` imports it), `CONTRIBUTING.md` holds
  the Definition of Done that every pull request is reviewed against, a pull request template,
  issue forms, `docs/SCOPE.md` (purpose and non-goals), and architecture decision records in `docs/adr/` (ADR-0002 privacy of the home
  location). The new `PR hygiene` check fails when code changes come without a test or
  changelog change, or when an ADR or a Markdown link is broken.
- repo-kit v2: `AGENTS.md` names a fast check (run before every commit and by the Claude Code
  stop hook in `.claude/settings.json`), the full check and the state of mutation testing;
  `CONTRIBUTING.md` adds how an idea becomes an accepted issue and the labels `accepted` and
  `out-of-scope`. New `Security` workflow (secret scan, dependency review) and weekly Dependabot
  updates for GitHub Actions.
