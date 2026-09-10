# StudyPilot Updated UI/UX

## Document Purpose

This document is the continuation handoff for StudyPilot's interface direction. It records:

- The baseline UX audit of the existing product.
- The Shopify Editions Winter '26-inspired update.
- The visual and interaction rules for future continuation work.
- Accessibility, responsive, content, and validation requirements.

The Shopify reference is used as design inspiration only. StudyPilot keeps its own product language, functionality, copy, routes, and study-planning context.

## Product Context

StudyPilot is a study-planning web app for students managing:

- Subjects and syllabus topics.
- Exams and deadlines.
- Daily study plans.
- Focus sessions.
- Progress and analytics.
- AI-assisted study guidance.

The product has two distinct interface modes:

1. **Public editorial surface**: landing, positioning, product storytelling, and conversion.
2. **Logged-in operating surface**: dashboard, planning, focus, syllabus, tasks, exams, and settings.

The public surface can be expressive and editorial. The logged-in surface must prioritize scanability, confidence, speed, and predictable interaction.

## Baseline UX Audit

### Strengths

- The product has a recognizable visual identity built from warm paper tones, forest green, slab-style display headings, and tactile controls.
- Desktop navigation is grouped into planning and growth tools.
- The dashboard combines today's plan, deadlines, exams, weak topics, weekly focus, and subjects.
- Empty states, loading states, progress indicators, badges, toast feedback, reduced-motion handling, and many accessible labels are already present.
- The app supports dark mode and a mobile bottom navigation pattern.
- The focus timer communicates the current state clearly and provides session completion feedback.

### Main UX Risks

#### Mobile navigation discoverability

The mobile dock exposes Home, Plan, Syllabus, Pilot, and Progress, while Exams, Tasks, Calendar, Focus, Achievements, and Settings are hidden from the primary mobile path.

**Continuation requirement:** add a clearly labelled More destination, sheet, or menu for all secondary routes. Do not make mobile users infer hidden routes.

#### Notification state consistency

The notification panel previously used the original unread prop for its rendered list while clearing local notification state after opening.

**Continuation requirement:** use one source of truth for both the unread badge and panel contents. After marking notifications read, the panel must immediately show the updated state.

#### Dialog accessibility

The dialog has Escape handling and a dialog role, but future work should ensure that focus cannot escape behind the modal. The title and description should be associated through `aria-labelledby` and `aria-describedby`.

**Continuation requirement:** use a reliable focus trap, restore focus to the trigger, and ensure all modal controls are keyboard reachable.

#### Form label association

The shared `Field` component supports `htmlFor`, but many consumers do not provide matching input IDs.

**Continuation requirement:** every visible form label must be programmatically associated with its control. Prefer generated IDs or an explicit required field ID.

#### Uniform depth

The original system applies raised or inset shadows to cards, buttons, fields, navigation, dialogs, and controls. This is memorable but can flatten hierarchy because ordinary surfaces and primary actions receive similar visual emphasis.

**Continuation requirement:** reserve strong elevation for floating or primary actions. Use spacing, typography, borders, and color blocks for ordinary structure.

#### Dashboard action hierarchy

The dashboard contains useful information but distributes the next action across several cards.

**Continuation requirement:** make the next recommended action explicit, such as `Start next session`, `Continue today's plan`, or `Review the nearest deadline`.

#### Dense task rows

Task rows combine completion, title, subject, type, deadline, duration, priority, status, edit, and delete controls.

**Continuation requirement:** stack metadata and controls at narrow widths. Preserve a large, easy-to-hit completion target.

#### Destructive actions

Delete actions should not rely only on immediate execution.

**Continuation requirement:** use confirmation for irreversible actions or provide a reliable undo action with a sufficient recovery window.

#### Onboarding load

Onboarding asks for subjects, difficulty, priority, color, topics, exams, deadlines, availability, and session style.

**Continuation requirement:** keep the first-run path focused on the minimum data needed to produce a useful plan. Defer optional detail until after activation.

## Shopify Editions-Inspired Direction

The reference direction is an editorial product edition rather than a conventional SaaS landing page.

### Design principles adopted

- Open with a large, declarative statement instead of a small eyebrow followed by a generic SaaS headline.
- Use chapters and section rhythm to create a product story.
- Give each section a strong visual field or editorial role.
- Use high-contrast color blocks to create memory and orientation.
- Let typography and spacing carry hierarchy instead of relying on repeated card elevation.
- Present product capability as a sequence of meaningful moments, not a grid of interchangeable feature cards.
- Use generous whitespace around major ideas.
- Keep the primary action visible and direct.
- Treat the product preview as evidence of the experience, not decoration.
- Make mobile composition intentional rather than treating it as a collapsed desktop layout.

### Design principles intentionally not copied

- Shopify branding, logos, naming, proprietary illustrations, or exact copy.
- Shopify's commerce-specific content hierarchy.
- Product claims that do not belong to StudyPilot.
- Any visual asset that implies an association with Shopify.

## Shipped Landing Page Update

The public landing page uses a scoped editorial layer, while the logged-in app now shares the same editorial principles through a calmer operating palette, clearer hierarchy, and improved interaction primitives.

### Hero changes

- The hero headline now leads with a semester-focused statement: `Your semester, finally in focus.`
- The previous generic three-line slogan treatment was replaced with a larger editorial headline.
- The primary action remains linked to `/signup`.
- The secondary action now points readers toward the product story through `Explore the edition`.
- The product preview remains present as functional evidence.
- Decorative shapes are flat geometric accents rather than blurred neumorphic orbs.
- The preview uses a crisp border and offset color block to establish an editorial object on the page.

### Header changes

- The landing header uses a quieter editorial treatment instead of the full tactile app shell treatment.
- The StudyPilot mark uses dark ink and lime contrast.
- The brand wordmark receives a small punctuation accent.
- Existing navigation and authentication routes remain unchanged.

### Section changes

- The landing page has a scoped `editorial-landing` visual system.
- Feature and pricing sections use stronger color fields to create chapter separation.
- Cards in the landing page have flatter borders and reduced shadow dependence.
- Hover treatment remains present but uses a small offset and colored shadow for editorial tactility.
- The logged-in app's cards and controls are not globally changed by this landing-only layer.

### Responsive behavior

- Hero type scales down at narrow widths.
- The preview offset shadow is reduced on mobile.
- Decorative shapes move away from the copy at narrow widths.
- Existing flex and grid behavior remains responsible for content stacking.

## Authenticated Product Update

The operating surface now follows the same direction with a more restrained, task-first interpretation.

### Global system

- Replaced the warm green-only operating palette with paper, ink, lime, coral, and blue accents.
- Reduced the default strength of raised and inset shadows.
- Converted cards to bordered, lightly elevated surfaces.
- Converted fields to clear bordered controls with focus rings instead of deep recessed wells.
- Kept the public landing page's stronger editorial colors scoped to that surface.

### App shell

- The top bar is now a quiet, lightly translucent editorial header.
- Active desktop navigation uses a clear primary marker and soft accent fill.
- Mobile navigation retains the five highest-frequency destinations and adds a `More` menu for Exams, Tasks, Calendar, Focus, Achievements, and Settings.
- The mobile More menu exposes `aria-expanded` and `aria-haspopup` state.
- Notifications render from live local state after being marked read.

### Dashboard

- Added a prominent `Start next session` action when a pending block exists.
- Falls back to `Open today's plan` when there is no next block.
- This makes the primary action visible before secondary analytics and planning detail.

### Shared interaction primitives

- Dialogs now expose proper title and description relationships.
- Dialog focus is kept within the open panel when tabbing.
- Buttons use clearer hierarchy, less rounded geometry, and stronger action weight.
- Icon-only controls retain accessible names.

## Visual System Continuation Rules

### Color

Use the public editorial palette for the landing and campaign surfaces:

- Paper: warm off-white background.
- Ink: near-black text and primary action.
- Lime: hero emphasis and active energy.
- Coral: emphasis, highlights, and secondary visual punctuation.
- Blue: large chapter or category bands.

Do not turn the entire product purple, beige, or dark blue. Do not use color as the only signal for status or action.

### Typography

- Use the existing display face for large editorial headings.
- Keep body copy readable and restrained.
- Use large type only for real statements, not compact dashboard labels.
- Avoid excessive negative letter spacing.
- Keep long-form body measures around 65 to 75 characters where practical.
- Do not introduce a new font without verifying its loading, licensing, and visual fit.

### Surfaces

- Public landing pages may use flat blocks, borders, and one deliberate offset shadow.
- Avoid repeating identical icon-heading-description cards as the primary page structure.
- Avoid nested cards.
- Keep card radii restrained, generally 12 to 16px for content surfaces.
- Use pills only for compact controls, statuses, and small labels.
- Do not use glass or blur as decoration without a specific readability or layering purpose.

### Motion

- Motion should clarify entry, state, or hierarchy.
- Keep one authored entrance or reveal system per surface.
- Respect `prefers-reduced-motion`.
- Avoid simultaneous floating, tilting, shining, pulsing, and stagger animations on the same viewport.
- Do not make an action feel slower than its task requires.

### Icons and controls

- Use Lucide icons consistently.
- Icon-only controls must have an accessible name and tooltip where the meaning is not obvious.
- Text buttons should describe the action, not the implementation.
- Preserve minimum touch targets of approximately 44px for primary mobile controls.
- Keep destructive controls visually distinct and provide recovery where possible.

## Logged-In App Continuation

The editorial landing page must not be allowed to make the operating app less efficient.

### Dashboard

- Prioritize the next study action in the first viewport.
- Keep progress meaningful and explain what the user should do next.
- Use cards for genuinely distinct tools, not every piece of information.
- Consider ledger rows for plans, deadlines, and schedule items.

### Navigation

- Keep desktop navigation stable and predictable.
- Add a mobile More menu for routes omitted from the bottom dock.
- Preserve `aria-current="page"` and clear active states.
- Avoid duplicating the same route under confusingly different labels.

### Tasks and syllabus

- Make completion the dominant row action.
- Keep edit and delete secondary.
- Stack metadata on mobile.
- Use confirmation or undo for destructive changes.
- Preserve filter counts and make the selected filter apparent to keyboard and screen-reader users.

### Focus mode

- Keep the timer as the visual anchor.
- Make Start, Pause, Resume, Finish early, and Complete & log states explicit.
- Do not hide the selected study topic while the session is active.
- Preserve the completion path even when a timer reaches zero.

### Onboarding

- Ask for the minimum viable study context first.
- Use human-readable color names or swatches instead of raw hex values.
- Clearly show progress, current step, completed steps, and what is required.
- Allow safe back navigation without losing entered data.
- Explain what will be generated and what the user can edit later.

## Accessibility Requirements

Every continuation update must verify:

- Keyboard access to navigation, menus, dialogs, tabs, filters, forms, and disclosures.
- Visible focus styles on every interactive control.
- Correct label-to-control relationships.
- Correct `aria-current`, `aria-selected`, `aria-expanded`, and dialog attributes.
- No color-only status communication.
- Text contrast of at least 4.5:1 for normal body text and 3:1 for large text.
- Reduced-motion behavior for entrance, hover, timer, and decorative animation.
- Focus restoration after dialogs and menus close.
- Error messages adjacent to the relevant field and exposed with `role="alert"` where appropriate.

## Content Rules

- Use StudyPilot's own language: plan, syllabus, deadlines, focus, readiness, progress, and Pilot.
- Avoid empty marketing phrases that do not explain a user outcome.
- Prefer direct labels such as `Build my study plan`, `Start focus`, `Review deadline`, and `Open syllabus`.
- Keep claims grounded in the current product behavior.
- Do not imply billing, AI, integrations, or automation that is not implemented.
- Keep helpful empty states specific about what the user can do next.

## Validation Checklist

Before shipping a UI/UX continuation update:

- [ ] Confirm the changed route and its primary user task.
- [ ] Inspect desktop and mobile layouts.
- [ ] Check narrow widths for text overflow and cramped controls.
- [ ] Check keyboard navigation and focus visibility.
- [ ] Check dark mode if the changed surface participates in the shared app theme.
- [ ] Check empty, loading, success, error, and destructive states.
- [ ] Confirm links and buttons retain their intended routes/actions.
- [ ] Run editor diagnostics for changed files.
- [ ] Run the project lint/typecheck commands from the actual workspace environment.
- [ ] Run the Impeccable detector once against changed UI files when available.
- [ ] Review the final screen as a hierarchy: primary task first, supporting context second, decoration last.

## Current Validation Note

The current editor diagnostics for `src/app/page.tsx` and `src/app/globals.css` are clean.

The terminal session used during the landing-page update resolved to a different physical `C:\Users\Varsh` folder than the virtual workspace, so the project lint script and visual detector could not be run from that shell. Future validation should use the workspace-aware task runner or a terminal opened at the actual repository root.

## Continuation Summary

The current design direction is:

> **StudyPilot as an editorial study edition: bold enough to invite attention in public, calm and precise enough to help students act inside the product.**

Future UI work should extend this distinction rather than flattening every surface into one visual style.
