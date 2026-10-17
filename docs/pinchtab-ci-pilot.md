# PinchTab CI pilot

## Purpose

This is an observation-only browser QA pilot for Swayphics. It complements the existing validate-site workflow, which performs static JavaScript syntax checks but does not render the site in a browser.

The benchmark found that Antigravity can reliably validate static source and route responses, but its current environment cannot render DOM state, emulate viewports, collect live browser-console errors, capture screenshots, or compare rendered site versions. PinchTab is being piloted specifically for that missing coverage.

## Trigger and scope

Workflow: [PinchTab Site Regression Pilot](../.github/workflows/pinchtab-site-regression-pilot.yml)

It runs manually through workflow_dispatch and on pull requests into main that touch the public website, route content, sitemap, media assets, or the pilot itself.

It:
1. Downloads the pinned PinchTab 0.15.2 Linux binary and verifies it against the release checksum.
2. Installs headless Chrome for Testing.
3. Starts PinchTab bound to 127.0.0.1; JavaScript evaluation remains disabled and no repository secrets are used.
4. Audits each of the seven public sitemap routes individually.
5. Serves the checked-out candidate site on a temporary loopback-only HTTP server.
6. Compares the live production routes to the checked-out candidate routes, saving report and visual-diff artifacts.
7. Uploads the audit JSON/HTML, screenshots, compare output, logs, CSV and summary.

## Why routes are audited individually

The initial local test with PinchTab 0.15.2 found that the sitemap-audit command failed with an unexpected end of JSON input, even though auditing individual URLs worked. The pilot deliberately bypasses that sitemap-report parsing path while covering every route listed in sitemap.xml.

## Safety and interpretation

- The job has read-only repository permissions and does not deploy, merge, submit forms, send messages, or mutate production data.
- PinchTab's security.allowEvaluate is not enabled.
- The preview server binds only to 127.0.0.1 and exists only for the duration of the job.
- Visual diffs are not a pass/fail gate in this pilot. They are expected if a pull request changes the live design and can also reflect content, font, media, timing, or viewport differences.
- Existing page errors, including the previously observed homepage empty-selector exception, are reported but do not by themselves fail the job.
- The job fails if PinchTab cannot create valid route reports or a valid compare report. This distinguishes tool reliability from website findings.

## Acceptance criteria

Review at least three successful workflow runs before deciding whether to retain PinchTab as a regular regression workflow. The pilot should demonstrate:

- Each of the seven routes produces a valid report and screenshot.
- The comparison produces valid route-pair data and inspectable visual-diff artifacts for the checked-out candidate.
- The reports reveal browser-only issues or visual changes that the static workflow cannot detect.
- Runtime cost and false-positive/noise levels are acceptable.

Do not enable fail-on-diff, require this workflow for merge, or adopt it as a hard release gate during the pilot. Make that decision only after reviewing artifacts from repeated runs and confirming that differences are actionable.
