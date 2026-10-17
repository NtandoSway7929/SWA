# Swayphics client-demo design tooling

This setup adds a repeatable design research and implementation process for client-specific website demos. It does not install software on another computer by itself: run the PowerShell setup script from a local checkout of this repository.

## What gets installed

- **UI/UX Pro Max**: a design-intelligence skill for design-system, style, typography, accessibility and UX research.
- **21st MCP**: component discovery and optional AI-assisted UI generation/review in Antigravity.
- **Swayphics client-demo skill**: repository-specific instructions in `.agents/skills/swayphics-client-website-demo/SKILL.md`.

We target the standard Agent Skills layout with `uipro init --ai universal`, rather than depending on Antigravity's legacy workflow files. Google's Antigravity documentation says standard skills live under `.agents/skills/` and legacy workflows are scheduled for retirement on 19 October 2026. See the current [Antigravity Skills guide](https://antigravity.google/docs/skills) and [workflow migration guide](https://antigravity.google/docs/migration/workflows-to-skills).

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
- [ ] Desktop/mobile and key interactions have been checked.
- [ ] No production, InnerMe, database, deployment or communication action was performed.
