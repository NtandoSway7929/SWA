# Upstream skill sources

This file is a maintenance and attribution record for third-party skills vendored under `.agents/skills/`. It is not a new skill and does not replace upstream documentation.

## Anthropic: frontend-design

- Upstream repository: https://github.com/anthropics/skills
- Upstream path: `skills/frontend-design/`
- Pinned source commit: `e4bb5d960d87126ff3b3a8af1a104b7db67560ba`
- Local path: `.agents/skills/frontend-design/`
- Licence: Apache-2.0; the upstream `LICENSE.txt` is included.
- Imported upstream `SKILL.md` and `LICENSE.txt` without rewriting the skill.

## Impeccable: design direction, critique and audit

- Upstream repository: https://github.com/pbakaus/impeccable
- Upstream path: `.agents/skills/impeccable/`
- Pinned source commit: `2fc5e1459efbbf06d92c7306517c286bf12490cf`
- Local path: `.agents/skills/impeccable/`
- Licence: Apache-2.0; the upstream `LICENSE` is included.
- Vendored the upstream skill, agent definitions, reference playbooks and scripts.
- **One upstream data asset is not included:** `scripts/data/font-index.json` (approximately 1.1 MB in the pinned source). The connected GitHub file reader returned an empty payload for this oversized file, so no substitute or fabricated file was committed. Upstream documentation says font matching has a built-in shortlist fallback when this index is absent; the full font-index ranking enhancement is therefore not part of this vendored copy.
- Impeccable's optional engine, hooks, installer and live-browser editing have not been installed or activated. Do not run installers, hooks, downloaded engines or live editing without explicit user approval.

## Addy Osmani: frontend UI engineering and accessibility engineering

- Upstream repository: https://github.com/addyosmani/agent-skills
- Pinned source commit: `e997ac5b9a74eab332d5e9793bb38a38c8cfdd74`
- Local paths:
  - `.agents/skills/frontend-ui-engineering/`
  - `.agents/skills/accessibility-engineering/`
- Licence: MIT; the upstream `LICENSE` is included in both local skill folders.
- Imported each upstream skill with its referenced accessibility checklist. The accessibility skill's audit script is included but has not been run.

## Local policy precedence

- The root repository's `.agents/product-marketing.md`, if present, describes Swayphics only. A client must have a separately scoped context; never reuse Swayphics positioning, brand voice, customer evidence or strategy for a prospect.
- Marketing-skill recommendations must distinguish observed evidence, reasoned implications and untested hypotheses. Never fabricate conversion, SEO, revenue, traffic, uplift or experimentation metrics.
- Playwright documentation does not mean the CLI or browser tooling is installed. Never install it or access personal browser state without explicit user approval. Keep testing isolated from live customer data and operations.

The repository's existing Swayphics art-direction standard remains in force. In particular, its 15 banned design tropes, client-specific brand separation, technology constraints and approval boundaries take precedence over conflicting recommendations in upstream material.

Upstream content is retained under its original licences. Review the pinned source commit and licence before updating or redistributing a skill. No runtime installer, external hook, downloaded binary, live browser editor, accessibility package installation or production deployment was run as part of this import.


## Corey Haines: marketing, conversion and SEO skills

- Upstream repository: https://github.com/coreyhaines31/marketingskills
- Pinned source commit: `2bf95edb4ebd37198ab7fd18b99ba95c2145ec64`
- Local paths:
  - `.agents/skills/cro/` (CRO skill and both referenced playbooks)
  - `.agents/skills/seo-audit/` (SEO audit skill and all five direct reference files plus the local SEO profile/citations companion)
  - `.agents/skills/ab-testing/` (A/B-testing skill and both referenced guides)
  - `.agents/skills/product-marketing/` (product-marketing skill and brand-voice reference)
  - `.agents/skills/marketingskills/LICENSE`
- Licence: MIT; the upstream `LICENSE` is included.
- Imported the four selected skills and every local reference linked by their `SKILL.md` files. This is a **selective import**, not the full marketing library. Related skills mentioned in prose (for example, `signup`, `popups`, `copywriting`, `analytics`, `ai-seo`, and `schema`) were not imported as part of this change. Optional partner integrations, MCP servers, credentials and marketing accounts were not installed or connected.
- Source repository had approximately 62.8k GitHub stars when checked on 2026-11-27; star counts are mutable and are recorded only as selection context.

## Microsoft: Playwright CLI browser automation skill

- Upstream repository: https://github.com/microsoft/playwright-cli
- Pinned source commit: `dc5f4d5616ab5a28ded12fd7101a4d49bd59a820`
- Local path: `.agents/skills/playwright-cli/` (upstream `SKILL.md` and all ten referenced guides)
- Licence: Apache-2.0; the upstream `LICENSE` is included.
- Source repository had approximately 15.5k GitHub stars when checked on 2026-11-27; star counts are mutable and are recorded only as selection context.
- The skill requires a separately installed Playwright CLI and Node.js 20+ according to its upstream documentation. Only the skill and reference documentation are vendored. No npm package, Node.js runtime, browser binary, MCP server, browser profile or persistent session has been installed or configured.
- The repository also has separate Playwright Node.js CI workflows: `.github/workflows/admin-table-controls-preview.yml`, `.github/workflows/admin-quick-create-accessibility.yml` and `.github/workflows/innerme-chat-browser-smoke.yml`. These install their own pinned `playwright` package and Chromium on GitHub-hosted runners for narrowly scoped fixtures. They do not install or invoke Microsoft's `playwright-cli`, and they do not provide generic coverage for `demos/**`.
- The routing and safety rules for using either form of browser testing are documented in `.agents/skills/swayphics-client-website-demo/SKILL.md` and `docs/client-demo-design-tooling.md`.
- The local client-demo workflow restricts browser checks to isolated, non-persistent test sessions and prohibits access to personal browser credentials, real customer accounts and unapproved live transactions. These local rules take precedence over any broader upstream examples.



## Dietrich Gebert: Ponytail coding discipline

- Upstream repository: https://github.com/dietrichgebert/ponytail
- Pinned source commit: `ebd8654c2c627f721eb8f9c0d1bd4090a29f9e10` (2026-11-22)
- Local path: `.agents/skills/ponytail/`
- Licence: MIT; the upstream root `LICENSE` is included.
- The original upstream `skills/ponytail/SKILL.md` is retained as `UPSTREAM-SKILL.md`; the local `SKILL.md` wrapper and `SWAYPHICS-ADAPTATION.md` keep the discipline subordinate to the user's complete request, repository architecture, required safeguards and approval boundaries.
- No root `AGENTS.md`, plugin installers, hooks or runtime tooling were imported or activated.

## Nutlope: Hallmark design skill (explicit opt-in)

- Upstream repository: https://github.com/nutlope/hallmark
- Pinned source commit: `04977e15f3dfd6ee4b74c887dac3eb52665d6c92` (2026-11-11)
- Upstream skill path: `skills/hallmark/`; local path: `.agents/skills/hallmark/`
- Licence: MIT; the upstream skill-directory `LICENSE` is included.
- Imported 178 of the 187 files in the pinned upstream skill directory: the original `SKILL.md` preserved as `UPSTREAM-SKILL.md`, all 101 Markdown reference files, all 50 theme preview JPGs, the theme index and photo catalogue, agent metadata, sample fixtures, and selected Node utilities/tests.
- Nine optional files were deliberately excluded: `scripts/capture.mjs`, `scripts/capture.test.mjs`, `scripts/imagegen.mjs`, `scripts/fixtures/imagegen/imagegen.test.mjs`, `scripts/install.mjs`, `scripts/install-hook.mjs`, `scripts/lint-hook.mjs`, `scripts/sloplint-render.mjs`, and `scripts/sloplint-render.test.mjs`. These cover browser capture/rendering, API-backed image generation, installation and hooks.
- The local `SKILL.md` is an explicit-opt-in wrapper. Read `SWAYPHICS-ADAPTATION.md` before the upstream prompt. The universal Swayphics art-direction standard, the client's verified identity, project instructions and user approvals take precedence over conflicting Hallmark defaults.
- The static linter and local theme-selection/scaffold utilities are vendored, but no Node runtime or npm package was installed or run. Do not use the omitted browser/API/installer features. `scripts/picture.mjs` is retained as upstream material but requires a separately approved Puppeteer/Chrome environment and must not be invoked by default.
- This is a selective skill-directory import, not a copy of Hallmark's root repository, site, plugin or installation system. No browser dependencies, API keys, MCP servers, hooks or installers were activated.
