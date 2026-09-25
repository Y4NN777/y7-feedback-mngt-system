# Y7 Feedback visual system

Status: approved implementation baseline for `TASK-UX-002`  
Anchor: Organic

## Product context

Y7 Feedback lets a Reporter share sensitive product feedback without an account and lets a product team retrieve and process that feedback. The interface must feel approachable on public routes and dependable on operational routes without becoming two different products.

## Direction

The visual system keeps the warm editorial character of the existing home page. It uses sand, sage, clay, ochre, and moss; Fraunces for expressive headings; Epilogue for interface text; rounded surfaces; and a restrained grain texture.

The differentiator is a **terraced journey**: major steps are placed on softly rounded surfaces with small horizontal offsets. The movement expresses progression while remaining legible at 320 CSS pixels. Operational screens use the same materials and typography with tighter spacing, not a separate visual language.

## Semantic tokens

Tokens describe purpose rather than a route or implementation:

- surfaces: canvas, raised, sage, oat, clay;
- text: primary, muted, inverse;
- actions: primary, primary-hover, danger;
- borders and focus: subtle border and moss focus ring;
- typography: display and interface families;
- spacing: page inset, section rhythm, control gaps;
- shape: control, panel, and round brand radii;
- motion: gentle interaction duration and easing.

Public and operational density variants may change spacing and maximum width. They must not change palette, typography, control grammar, focus treatment, or status semantics.

## Behavior matrix

| Scenario | Given | When | Then |
|---|---|---|---|
| `BDD-UX-SYSTEM-001 semantic tokens` | the product stylesheet loads | any entry route renders | semantic surface, text, action, focus, spacing, type, shape, and motion tokens are defined |
| `BDD-UX-SYSTEM-002 single identity` | a user moves between Home, Retrieve, team sign-in, and unavailable Project | the destination renders | the Organic anchor, brand, language control, type hierarchy, and action grammar remain recognizable |
| `BDD-UX-SYSTEM-003 density variants` | public and operational pages have different information density | the viewport changes | both use the same tokens while spacing adapts without horizontal loss |
| `BDD-UX-SYSTEM-004 locale continuity` | a user has entered form data | the locale changes between FR and EN | form data and current task remain unchanged |
| `BDD-UX-SYSTEM-005 keyboard visibility` | a keyboard user focuses an interactive control | focus moves | a non-color-only, high-contrast focus ring is visible |
| `BDD-UX-SYSTEM-006 reduced motion` | the operating system requests reduced motion | an interaction changes state | non-essential transitions and animations are disabled |

## Representative compositions

The system is validated on five surfaces before wider adoption:

1. Home: editorial public density and terraced journey cards.
2. Retrieve: focused operational density with reference/proof form visible early.
3. Team sign-in: requested destination remains explicit before authentication.
4. Reporter intake: form state and locale continuity remain intact.
5. Unavailable Project: branded recovery with primary Home and secondary Retrieve actions.

Required viewports: 375 × 812, 768 × 1024, and 1280 × 720. Every composition must pass keyboard navigation, WCAG A/AA automated checks, FR/EN switching, and horizontal-overflow checks.

The `TASK-UX-002` baseline renders are stored outside Git under
`~/.gstack/projects/Y4NN777-y7-feedback-mngt-system/designs/milestone-a/task-ux-002/`.
All three inspected widths reported zero horizontal overflow and no browser console errors.

## Content rules

- Standard actions keep standard labels.
- No decorative labels or fabricated product data.
- Unavailable states are guidance, not action-shaped controls.
- Errors identify the next safe action without revealing protected resources.
