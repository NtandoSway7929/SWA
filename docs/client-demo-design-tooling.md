# Swayphics client-demo design tooling

This setup adds a repeatable design research and implementation process for client-specific website demos. It does not install software on another computer by itself: run the PowerShell setup script from a local checkout of this repository.

## What gets installed

- **UI/UX Pro Max**: a design-intelligence skill for design-system, style, typography, accessibility and UX research.
- **21st MCP**: component discovery and optional AI-assisted UI generation/review in Antigravity.
- **Swayphics client-demo skill**: repository-specific instructions in `.agents/skills/swayphics-client-website-demo/SKILL.md`.

We target the standard Agent Skills layout with `uipro init --ai universal`, rather than depending on Antigravity's legacy workflow files. Google's Antigravity documentation now recommends standard Agent Skills under `.agents/skills/` instead of relying on the legacy workflow format. See the current [Antigravity Skills guide](https://antigravity.google/docs/skills) and [workflow migration guide](https://antigravity.google/docs/migration/workflows-to-skills).

## Install on Windows

1. Install Node.js/npm and Python 3 if they are not already installed.
2. Open PowerShell in the local root directory of `NtandoSway7929/SWA`.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-client-demo-design-tools.ps1
   ```

4. The script installs the UI/UX Pro Max CLI, initializes its standard Agent Skill for the current project and offers to configure 21st MCP. It preserves other MCP servers in an existing config.
5. Restart or refresh Antigravity's MCP server list. In Antigravity, open **Settings → Customizations → Installed MCP Servers** and check that 21st is connected. If needed, inspect the workspace config at `.agents/mcp_config.json`.

The setup script never sends an email, deploys a demo, edits production pages or changes Supabase. The 21st key is requested as hidden terminal input and written only to the local MCP config, which is ignored by Git. Do not paste API keys into website source code, prompts, screenshots or tracked files.

## Manual installation

If you prefer not to run the script, execute these commands from the repository root:

```powershell
npm install -g ui-ux-pro-max-cli@latest
uipro init --ai universal
```

UI/UX Pro Max uses Python 3 for local search scripts. If the skill is installed under a different path by a later CLI release, inspect the generated `SKILL.md` and use that installed path rather than copying a guessed path.

For 21st, create a key through [21st.dev/mcp](https://21st.dev/mcp). Antigravity's MCP config requires `serverUrl` for remote servers; the legacy `url` property is not supported by the current Antigravity config schema. The workspace-local configuration format is:

```json
{
  "mcpServers": {
    "21st": {
      "serverUrl": "https://21st.dev/api/mcp",
      "headers": {
        "x-api-key": "PASTE_YOUR_21ST_API_KEY_HERE"
      }
    }
  }
}
```

This is an example only. Do not commit a real-key version of this file. Save the real configuration as `.agents/mcp_config.json` locally; the repository's `.gitignore` excludes that path and leaves other workspace skills tracked. If a config already exists, merge the `21st` entry into it rather than deleting other server entries.

Official references:
- [UI/UX Pro Max installation guide](https://ui-ux-pro-max-skill.com/docs/cli-reference/)
- [21st MCP](https://21st.dev/mcp)
- [21st MCP repository setup notes](https://github.com/21st-dev/magic-mcp)
- [Antigravity MCP configuration](https://antigravity.google/docs/mcp)

## Cost and availability notes

21st search/publishing and its hosted AI generation have different usage conditions. The current 21st MCP page describes search as free with two component installs per day, while AI generation uses credits. Confirm current account allowances before using generation repeatedly. UI/UX Pro Max's local design-system search requires Python 3.

## Standard client-demo procedure

1. Confirm the lead name and use only business facts supplied by the user or verified from the client's public sources. Record uncertainties.
2. Research the industry and target audience with UI/UX Pro Max before choosing the design system. Select the client's own color palette and typography; do not apply Swayphics' palette to a client's demo unless the client actually uses it.
3. Use 21st to discover relevant components and patterns where helpful. Treat returned React/Tailwind code as reference only if this project is constrained to Vanilla HTML/CSS/JavaScript. Recreate suitable patterns in the allowed stack rather than introducing a framework.
4. Design around the client's conversion goal (for example, an enquiry, booking, call or WhatsApp conversation). Keep calls to action specific and make important interactions functional.
5. Use credible client assets or suitable stock imagery. Do not fabricate reviews, awards, prices, addresses, business hours, contact details or integrations. Mark unknown launch details for confirmation rather than presenting them as fact.
6. Keep each demo isolated from the production website, admin dashboard, InnerMe, backend functions and Supabase data. No production deployment or outbound contact is part of creating a demo.
7. Inspect mobile and desktop layouts, semantic structure, keyboard access, contrast, reduced-motion behavior, broken links/assets and JavaScript console errors. Run the repository's relevant validation checks and report what was actually tested.
8. Hand off the demo with a brief summary of the prospect's conversion gap, key design decisions, demo path, verified facts/remaining confirmations and test results.

## Browser verification and existing CI

The repository has two different Playwright interfaces. Keep them distinct:

- The Microsoft skill at `.agents/skills/playwright-cli/SKILL.md` documents the separate `playwright-cli` tool for interactive agent-driven browser sessions.
- The repository's existing automated tests import the `playwright` Node.js package directly (for example, `const { chromium } = require("playwright")`). GitHub Actions installs pinned package versions and Chromium on hosted runners for the relevant workflow. This does not install the Microsoft CLI on a developer's computer.

### Existing browser workflows

| Workflow | Current scope | Do not treat it as |
|---|---|---|
| `.github/workflows/validate-site.yml` | Node.js syntax checks, repository contract tests and inline-script validation | A rendered browser or responsive visual test |
| `.github/workflows/admin-table-controls-preview.yml` | Isolated desktop/mobile browser coverage for the admin table-controls fixture, mocked API behavior and selected persistence against a disposable local Supabase stack | Client-demo website QA |
| `.github/workflows/admin-quick-create-accessibility.yml` | Keyboard/focus checks for the isolated admin quick-create preview | A generic accessibility or client-demo audit |
| `.github/workflows/innerme-chat-browser-smoke.yml` | Mocked-backend browser smoke coverage for the InnerMe chat UI | A public website or client-demo test |

These workflows are deliberately path-scoped. As of 27 November 2026, the reviewed workflow set does not include a general browser workflow triggered for `demos/**`. Do not add client demo paths to an admin or InnerMe workflow merely to obtain a green CI result.

### Client-demo browser QA procedure

1. Run applicable source checks first: HTML/JavaScript syntax, local asset existence, link targets and the demo's own non-networked interaction checks.
2. Start any local preview server on loopback only (`127.0.0.1`), not a public or LAN-bound interface.
3. If Microsoft's `playwright-cli` is already installed and available, use its non-persistent in-memory session against the local demo. Do not install it as a fallback. Do not use the `attach`, `--persistent`, `--profile`, cookie or storage-state commands for a client demo.
4. Inspect at desktop and mobile viewport sizes. Check the primary simulated conversion path, keyboard/focus behavior, responsive overflow, console errors, failed asset requests and reduced-motion behavior.
5. Never submit a real form, send a message, book an appointment, make a payment, access an authenticated customer account or write production data.
6. Record the actual tool, viewport sizes, interactions and results. A syntax test is not a browser test; a screenshot alone is not proof that interactions work. Mark anything not executed as **not run**.

If no browser runtime is available, complete the source-level checks and provide the exact manual browser checks still required. Do not claim visual or interaction verification. The current admin and InnerMe browser workflows do not cover standalone client demos.

## Reusable Antigravity prompt

```text
Use the swayphics-client-website-demo skill to create a website demo for [LEAD / BUSINESS].

First inspect the available lead brief, existing demo conventions and supplied assets. Verify public business facts where necessary and label anything unverified. Use UI/UX Pro Max to research the industry and define the client-specific design system before coding. Use 21st MCP to discover suitable components if it is connected, but adapt them to the repository's Vanilla HTML, CSS and JavaScript constraints.

The client's brand is the source of truth for this demo. Do not use the Swayphics palette unless it belongs to the client. Prioritize conversion, authenticity, responsive behavior and working interactions over decorative effects. Do not invent testimonials, prices, contact details or integrations. Keep the demo isolated: do not edit the production homepage, admin dashboard, InnerMe, Supabase, deployment configuration or unrelated pull requests. Do not deploy or send anything. Finish with the demo path, facts needing confirmation, checks run and any remaining blockers.
```

## Acceptance checklist

- [ ] UI/UX Pro Max standard skill exists locally and its search script can run.
- [ ] Antigravity lists the 21st MCP server as connected, or the setup blocker is recorded.
- [ ] The Swayphics client-demo skill is discoverable from the workspace.
- [ ] The demo uses the client's brand, not Swayphics' by default.
- [ ] The implementation uses Vanilla HTML/CSS/JavaScript only.
- [ ] Desktop/mobile and key interactions have been checked in an actual browser, or remaining browser checks are explicitly recorded as not run.
- [ ] Existing CI runs are cited only for the exact admin/InnerMe scope they test; they are not used as evidence for client-demo browser QA.
- [ ] No production, InnerMe, database, deployment or communication action was performed.
