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
- The local client-demo workflow restricts browser checks to isolated, non-persistent test sessions and prohibits access to personal browser credentials, real customer accounts and unapproved live transactions. These local rules take precedence over any broader upstream examples.

