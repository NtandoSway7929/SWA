# Swayphics adaptation and safety boundary

## Activation

Hallmark is opt-in. Do not load or apply it for a routine request to design, build, redesign, review or improve a website or interface. Activate it only when the user explicitly names "Hallmark", asks for "Hallmark mode", or requests a Hallmark audit/redesign. Do not apply it to an existing design unless the user expressly asks for a Hallmark redesign.

## Instruction authority

Apply this order when working in SWA:

1. The user's current instructions, scope, approvals and acceptance criteria, plus applicable platform safety requirements.
2. The repository's project-specific instructions, architecture and production-safety boundaries.
3. The universal Swayphics art-direction standard and the client's verified brand identity, supplied assets and approved brief.
4. The Swayphics client-demo workflow where a client demo is involved.
5. This adaptation.
6. The upstream Hallmark instructions and references.

Hallmark's non-waivable "Floor" is upstream guidance, not superior authority. Where a rule conflicts with the Swayphics art-direction standard, a verified client brand, accessibility, the existing design system or the user's explicit request, follow the higher-priority requirement and record the reason when useful.

## Project identity and implementation

- Hallmark is a design method, not a replacement brand. Never apply Swayphics colours, typography, logo, voice or layout to a client by default.
- Preserve official logos and approved assets. Never fabricate testimonials, reviews, metrics, awards, claims, prices or integrations.
- Follow the project's actual stack. In SWA, use existing Vanilla HTML, CSS and JavaScript conventions; do not introduce React, Tailwind, packages, services, APIs or external tooling without explicit approval.
- Inspect current files and propose the scope before edits. Respect existing repository protections and do not publish, deploy, or change production systems without approval.
- A Hallmark "Picks" or audit report must distinguish verified material, design inference and absent proof. Do not imply a simulated interaction is live.

## Tooling included and excluded

This is a selective, source-pinned import of Hallmark's skill resources. Static, zero-dependency Node utilities and their supporting references are included, but no runtime was installed or executed as part of this import.

Do not invoke or install the omitted upstream features:
- browser capture (scripts/capture.mjs and its test);
- render-tier linting (scripts/sloplint-render.mjs and its test, including sloplint --render);
- browser screenshot comparison (scripts/picture.mjs) unless the user separately approves an available Puppeteer/Chrome environment;
- Together AI image generation (scripts/imagegen.mjs and its test) or any API key;
- installer and hook utilities (scripts/install.mjs, scripts/install-hook.mjs, scripts/lint-hook.mjs).

These files are intentionally absent. No npm package, browser binary, browser profile, global hook, MCP server or API integration was installed, configured or activated. Do not try to repair their absence by installing dependencies. For ordinary code verification, use the repository's existing checks. Where the static Hallmark linter is appropriate and Node 18+ is already available, use only node scripts/sloplint.mjs <path> without --render; do not claim visual/browser verification from a static lint run.

theme.mjs and its local theme/photo catalogue are included for optional local theme selection and scaffold generation. Inspect its help and use only commands that do not launch a browser or call an external service.

## Source fidelity

The upstream prompt is retained verbatim as UPSTREAM-SKILL.md. The local wrapper and this file are Swayphics additions. The provenance record identifies the pinned commit, MIT licence and intentionally excluded files.
