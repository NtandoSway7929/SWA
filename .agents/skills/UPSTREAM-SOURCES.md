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

The repository's existing Swayphics art-direction standard remains in force. In particular, its 15 banned design tropes, client-specific brand separation, technology constraints and approval boundaries take precedence over conflicting recommendations in upstream material.

Upstream content is retained under its original licences. Review the pinned source commit and licence before updating or redistributing a skill. No runtime installer, external hook, downloaded binary, live browser editor, accessibility package installation or production deployment was run as part of this import.
