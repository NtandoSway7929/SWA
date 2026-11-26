---
name: swayphics-art-direction
description: Set and enforce deliberate, human-directed visual and interaction standards whenever designing, describing, wireframing, reviewing or implementing websites, landing pages, web apps, dashboards or frontend interfaces for Swayphics or any Swayphics client. Use alongside project-specific, client-demo, UX and frontend skills.
---

# Swayphics Art Direction System

## Mission

Create distinctive, considered digital experiences that look deliberately art-directed for the specific organisation, audience, offer and task. Reject generic LLM/SaaS template styling. Every layout, typographic decision, surface, interaction and line of copy must have a clear reason to exist.

This is a **universal design-quality standard for Swayphics work**, not a Swayphics brand skin. It applies to:
- Swayphics' own public website and digital products;
- client websites, landing pages, web apps and dashboards;
- client website demos, proposals, redesigns and production implementations;
- UI components, design descriptions, wireframes and frontend code.

Use it for both new work and meaningful redesigns. Apply it together with the repository's project-specific instructions and any relevant specialist skills.

## Authority and project identity

### Universal rules versus project-specific identity

The 15 banned design tropes and the positive design standards in this skill apply to every project. They are not a preselected visual theme.

The **project's own verified brand and requirements** determine its identity:
- Never apply Swayphics colours, typography, logo, tone of voice or visual motifs to a client by default.
- Never make different clients look like variations of one Swayphics template.
- For client work, use the client's supplied or independently verified identity, audience, industry context and approved brief.
- For Swayphics-owned work, use the Swayphics brand preset below.
- If a client has no established or verifiable identity, develop a clearly labelled proposed direction from the client's audience, offer and context. Do not present a proposed palette, font or brand attribute as an existing client brand fact.
- Preserve official client and Swayphics logo assets. Do not redraw, recolour, distort, crop improperly or substitute an official logo without explicit approval.
- Follow applicable project constraints, user approvals, accessibility requirements, legal requirements and existing repository architecture. Do not introduce a new framework, library, service or integration without the necessary approval.

### Swayphics-owned project preset

Use these inputs only when the project is Swayphics itself, not when designing for a client:
- **Brand:** Swayphics.
- **Colours:** #002096, #0031C5, #0152F4, #2C91FC, #77C1FC and #FFFFFF. Charcoal and neutral surfaces may be used where appropriate.
- **Typography:** Raleway for headings; Montserrat for body copy, UI and buttons.
- **Aesthetic:** premium, polished, structured, high-contrast, deliberate whitespace and authentic relevant imagery.
- **Technology:** Vanilla HTML, CSS and JavaScript unless an explicitly approved project specifies otherwise.
- **Logo:** use the existing official Canva brand-kit logo asset only. Do not redraw, edit, recolour, alter transparency or substitute it.
- Respect all current Swayphics repository safety rules. In particular, do not change protected production pages, admin/client portals, deployment configuration or Supabase schema/data without explicit authorisation.

## Project art-direction brief

Before designing, establish the following from the user's brief, repository, supplied assets and credible project evidence. Ask only for essential missing information; otherwise make clearly labelled, reversible design recommendations rather than inventing facts.

1. **Project and organisation:** name, business type, website or product being designed.
2. **Audience:** primary users, their needs, context, accessibility needs and level of familiarity.
3. **Purpose:** the main business or product goal and the user's primary task.
4. **Conversion or task path:** the one most important action, such as booking, enquiry, purchase, registration or completing a workflow.
5. **Brand identity:** verified palette, typography, logo files, brand guidelines, tone and visual assets.
6. **Content and evidence:** approved copy, verified business facts, services, pricing, proof points and required disclosures.
7. **Visual direction:** references, aesthetic preferences, industry conventions worth retaining or rejecting, and required differentiation.
8. **Technology:** existing stack, browser support, dependencies, integrations, hosting and repository constraints.
9. **Operational constraints:** timeline, budget, content gaps, privacy, security, accessibility and maintenance.
10. **Approval boundaries:** what can be proposed, what is approved, and which production changes require explicit permission.

Do not fabricate metrics, customer counts, reviews, awards, credentials, certifications, availability, prices, integrations, business claims or conversion results. Separate verified facts, reasonable design inferences and proposed creative direction.

## Strict prohibitions: 15 banned AI design tropes

Apply every rule below to all design descriptions, wireframes, visual concepts and frontend implementations. Do not include a banned pattern merely because it is common, fast to implement or requested by a generic reference template.

### 1. No purple-blue gradients

Do not use purple, violet, indigo or magenta-to-blue linear or radial gradients on hero backgrounds, buttons, cards, borders, icons or badges.

Use restrained solid surfaces, crisp neutral contrast and the actual project palette. Do not reinterpret a client's brand with an unrelated gradient.

### 2. No defaulting to Inter everywhere

Do not lazily apply Inter to every heading, body paragraph and UI element.

Choose an intentional type system based on the project's identity and reading needs. Respect the client's documented typefaces when they exist. A specified brand font may be used deliberately; do not use Inter as an unconsidered default.

### 3. No gradient text fills

Do not apply colour-shifting gradients to headlines, hero titles, highlighted words or statistics. Do not use background-clip text or transparent text-fill tricks to create gradient lettering.

Build hierarchy with solid text colours, scale, weight, tracking, line length and placement.

### 4. No empty announcement pills above hero headlines

Do not add floating eyebrow pills, capsule tags, sparkle announcements or labels such as “INTRODUCING” above the main H1 merely to fill space.

Let the headline stand on its own with confident whitespace. A small label is appropriate only when it communicates a real, specific release or category relevant to the project.

### 5. No glowing halos or ambient radial blobs

Do not use blurred radial light leaks, neon backlights, glowing orbs or ambient colour halos behind hero sections, product mockups or dark containers.

Create depth through grids, contrast, authentic imagery, negative space and precise alignment.

### 6. No pervasive frosted glass

Do not use translucent blurred panels or backdrop-filter blur as a default treatment for cards, navigation, modals and overlays.

Prefer opaque surfaces, intentional elevation, hairline borders and tonal separation. Use transparency only when a specific interaction or visual requirement justifies it, not as a generic style.

### 7. No rounded-square icon tiles above every heading

Do not place a tinted rounded-square tile containing a generic icon above every feature title or section heading.

Use strong typography, relevant visuals, diagrams, structured lists or subtle inline icons only where they improve understanding or scanning.

### 8. No cookie-cutter feature-card grids

Do not default to repetitive three-column or three-by-two grids of identical cards with the same icon tile, title length and blurb structure.

Let content importance determine the layout. Use editorial splits, asymmetric compositions, full-width showcases, comparison tables, varied visual weights and other structures where they improve comprehension.

### 9. No nested containers

Do not place bordered cards inside bordered wrapper panels inside boxed sections.

Keep visual depth flat. Use at most one layer of container framing when needed; rely on whitespace, alignment, typography and dividers to organise information.

### 10. No thick coloured side stripes on ordinary cards

Do not add thick left or right border stripes to standard content cards, features or testimonials.

Reserve stripe callouts for genuine system alerts, warnings or information notices where the treatment has meaning.

### 11. No fabricated vanity statistics

Do not invent oversized numbers such as “10M+”, “99.9% uptime” or performance figures, nor pair large placeholder numbers with tiny uppercase labels.

Show numerical claims only when they are real, verified and relevant. Give them meaningful context and proportional emphasis.

### 12. No decorative micro-numbering

Do not add tiny decorative “01”, “02”, “03” labels above headings, cards or list rows merely as filler styling.

Use clear headings, meaningful sequence and natural visual flow.

### 13. No fake pulsing status dots

Do not use animated green dots, ping animations or “all systems operational” indicators unless the project is an actual live status interface connected to real telemetry.

Omit status indicators when nothing is being monitored.

### 14. No AI-buzzword copy or artificial em-dash rhythm

Avoid generic marketing clichés, including “supercharge your workflow”, “world-class”, “enterprise-grade”, “next-generation”, “revolutionary”, “seamless”, “game-changing”, “unlock”, “elevate” and “AI magic”, unless a phrase is an unavoidable verified product term or direct approved quotation.

Do not overuse em dashes to manufacture rhythm. Write specific, concrete, audience-appropriate copy that describes actual outcomes, features and actions. Never invent guarantees or results.

### 15. No beige-and-italic-serif anti-AI fallback

Do not escape SaaS styling by automatically switching to warm beige or cream backgrounds with a contrasting italic serif word in the middle of a display headline.

Do not replace one recognisable template with another. Develop a visual identity that follows the actual brand, audience, subject matter and content.

## Positive design standards

### Content-first structure

- Let the actual message, product, content and workflow determine the layout.
- Do not force every project into a familiar landing-page sequence or prebuilt component arrangement.
- Put the most important information where the target audience can understand it quickly.
- Make the primary action clear without making every section compete for attention.
- Use real content lengths and real asset proportions when designing, not only placeholder copy.

### Deliberate rhythm and whitespace

- Establish a consistent spacing scale and apply it across the page.
- Alternate dense and open sections based on content and narrative importance.
- Maintain precise alignment across columns, baselines, edges and responsive breakpoints.
- Use readable line lengths, considered hierarchy and sufficient separation between unrelated content.
- Check that desktop and mobile compositions are intentionally designed, not merely compressed versions of each other.

### Clean restraint

- Limit accent colours to purposeful actions, active states and meaningful emphasis.
- Use contrast, typography, scale, image composition and layout before adding decoration.
- Use borders, shadows, radii, textures and motion selectively and consistently.
- Prefer authentic, relevant imagery over generic stock imagery or artificial graphics that do not support the subject.
- Give every decorative element a clear design purpose. Remove it if it does not improve meaning, navigation, usability or brand expression.

### Interaction and accessibility

- Make interactive affordances clear and consistent.
- Provide visible keyboard focus, semantic structure, accessible names and labels, usable contrast and appropriate touch targets.
- Do not rely on colour alone to communicate state or meaning.
- Respect reduced-motion preferences. Motion should clarify a transition or provide useful feedback, never distract from the task.
- Design error, empty, loading, success and disabled states only where the underlying workflow supports them. Never imply live functionality that is not connected.

### Human copy and truthful content

- Write for the actual audience and task, not for a design trend.
- Prefer concrete nouns and verbs over abstract claims.
- Keep headings specific and useful. Avoid filler statements and unsupported superlatives.
- Preserve verified client terminology and tone. Do not impose Swayphics' voice on a client.
- Clearly label simulated demo interactions and unverified content.

## Implementation standards

- Translate the art direction into working structure, not just a visual description.
- Follow the project's existing stack, code conventions and architecture.
- Do not introduce React, Tailwind, UI libraries, animation packages, icon packs, fonts or other dependencies unless the project permits them and the user has approved any required change.
- Use maintainable semantic markup, scoped styling and purposeful JavaScript.
- Keep responsive behavior, accessibility and performance in scope from the beginning.
- Avoid unnecessary effects, scripts, external requests and third-party tracking.
- Use the real approved project assets. Do not alter official logos.
- Ensure the copy and interface do not promise functionality that is absent from the implementation.
- For existing projects, inspect the repository and relevant files before editing. Make surgical changes and respect protected paths and approval boundaries.

## Mandatory pre-output self-audit

Before presenting any design description, wireframe, mockup direction, design-system proposal or frontend code, silently inspect the result against **all 15 prohibitions**.

Explicitly check that it contains no:
1. purple/blue gradient;
2. lazy Inter-everywhere typography;
3. gradient text;
4. empty hero announcement pill;
5. glowing halo or radial blob;
6. gratuitous frosted glass;
7. repeated rounded-square icon tiles;
8. cookie-cutter feature-card grid;
9. nested containers;
10. thick side stripe on ordinary cards;
11. invented vanity statistic;
12. decorative micro-numbering;
13. fake pulsing status dot;
14. AI-buzzword copy or excessive em dashes;
15. beige-and-italic-serif anti-AI fallback.

If any appears, remove it and redesign the affected element before delivery. Also confirm that:
- the project identity is its own, not copied from Swayphics or another client;
- all brand claims and content are verified or clearly marked as proposed;
- the main user task is understandable;
- mobile, desktop, keyboard and reduced-motion behavior have been considered;
- the implementation respects the approved technology stack and repository boundaries.

Do not claim that an audit, browser check or test was completed if it was not actually performed. For a code delivery, report important checks performed and disclose any checks that remain unverified.

## Reusable project input block

Use this as the internal project brief for each new website or interface. Populate what is known; do not invent missing facts.

- **Brand / Project Name:**
- **Client / Organisation:**
- **Website / Product Type:**
- **Primary Audience:**
- **Primary User Need:**
- **Business or Product Goal:**
- **Primary Conversion / User Action:**
- **Verified Brand Colours:**
- **Heading Typeface:**
- **Body / UI Typeface:**
- **Brand Voice:**
- **Aesthetic Direction:**
- **Approved Logos and Assets:**
- **Verified Content and Proof:**
- **Required Pages / Workflows:**
- **Technology Stack:**
- **Integrations and Dependencies:**
- **Accessibility / Privacy Requirements:**
- **Repository and Deployment Constraints:**
- **Approval Boundaries:**
- **Unverified Items Requiring Confirmation:**

The art direction must be recognisably suited to the current project. Reuse this standard's design discipline, never a previous project's finished visual identity.
