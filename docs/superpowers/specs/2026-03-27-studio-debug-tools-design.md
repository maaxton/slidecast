# Studio Debug Tools — Layer Inspector, Render Pipeline, Screen Preview

**Date:** 2026-03-27
**Status:** Approved

## Problem

Debugging rendering issues requires jumping between three disconnected places: the studio editor, the debug page at `/ext/slidecast/debug`, and raw API calls. There's no way to compare what the editor shows vs what gets rendered. The debug page isn't discoverable from the studio. Render errors and queue status require API calls to see.

## Solution

A new dedicated debug page at `/ext/slidecast/debug-studio` launched from the studio's Help menu. Opens in a new tab with the current cast and slide pre-selected via query params. Three tabs: **Layer Inspector**, **Render Pipeline**, **Screen Preview**.

The page serves both developers (deep technical diagnostics) and cast designers (visual "why does it look wrong?" answers).

## Entry Point

**Studio Help menu** gets a new item: **"Debug Layers"** which opens:
```
/ext/slidecast/debug-studio?cast={castId}&slide={slideIndex}
```

The page is a standard SvelteKit extension page using Jewel Design components.

## Tab 1: Layer Inspector

Shows every rendered layer for the current slide as a card grid.

### Top Bar
- Tab navigation (Layer Inspector / Render Pipeline / Screen Preview)
- Cast name (read-only)
- Slide selector dropdown (switches between slides)
- "Re-render All" button (force re-renders current slide)

### Render Stats Bar
- Total layers count
- Rendered count (green)
- Native/screen-rendered count (blue)
- Skipped/cached count (yellow)
- Failed count (red)
- Time since last render

### Layer Cards

Each non-native element gets a card showing:

| Section | Content |
|---------|---------|
| **Header** | zIndex, element type, status badge (rendered/skipped/failed/native) |
| **Preview** | Layer PNG on checkerboard transparency background (click for full-size) |
| **Metadata** | Position (x,y), size (w,h), filename, contentHash (truncated) |
| **Actions** | Compare, Open Render, Re-render, JSON buttons |

**Status badges:**
- `rendered` — green, element was rendered to PNG
- `skipped` — yellow, element unchanged (cached)
- `failed` — red border, error message shown in card body
- `native` — blue, rendered live by display device (clock, date, countdown, video)

**Action buttons:**
- **Compare** — opens a modal with side-by-side: editor element rendering (via the studio's SlideRenderer) vs the layer PNG. Same element, two render paths.
- **Open Render** — creates a render-data token and opens `/protocol/render-element?token={token}&debug=true` in a new tab. Shows exactly what Playwright sees.
- **Re-render** — force re-renders just this element. Calls a new protocol endpoint to re-render a single element layer.
- **JSON** — expands/collapses the raw element JSON in a tree view below the card.

**Native elements** show a dashed placeholder instead of a preview, with the text "Rendered live by display". Only the JSON button is available.

**Failed elements** have a red border. The card body shows the error message (from renderErrors). The Re-render and Open Render buttons are highlighted.

### Data Source

- `GET /protocol/slide-layers/{castId}/{slideIndex}` — layer metadata, render stats
- `GET /protocol/slide-layer/{castId}/{slideIndex}/{filename}` — layer PNG images
- `POST /protocol/render-data` — create tokens for "Open Render" links
- `GET /render-errors` — recent render errors (authenticated)

### New Endpoint Needed

`POST /protocol/rerender-element` — re-renders a single element layer without re-rendering the entire slide. Accepts `{castId, slideIndex, elementId}`. Returns `{success, status}`.

## Tab 2: Render Pipeline

Queue status, per-slide render status, and error log. The "why is it slow/stuck?" tab.

### KPI Cards (top row, 4 cards)

| Card | Value | Source |
|------|-------|--------|
| Queue Depth | Number of pending renders | `GET /protocol/render-status` → queue size |
| Active Renders | Currently rendering | render-status → active count |
| Recent Errors | Error count | `GET /render-errors` → array length |
| Last Full Render | Time of most recent render completion | render-status or slide-layers metadata |

### Slide Render Status Table

| Column | Content |
|--------|---------|
| # | Slide index |
| Name | Slide name from cast definition |
| Layers | Layer count (or "—" if not rendered) |
| Status | cached / rendering / queued / failed (color-coded) |
| Action | "Force" button (re-render) or "Retry" for failed |

Below the table:
- "Re-render All Slides" button — queues all slides for re-render
- "Clear Cache" button — clears render cache for the cast

### Recent Errors Panel

Scrollable list of recent render errors from `/render-errors`:
- Element type + truncated ID
- Relative timestamp ("2m ago")
- Error message in monospace
- "Clear Errors" button at bottom

### Data Source

- `GET /protocol/render-status` — queue depth, active renders, failures
- `GET /protocol/slide-layers/{castId}/{slideIndex}` — per-slide status (polled for each slide)
- `GET /render-errors` — error history

## Tab 3: Screen Preview

Side-by-side comparison of editor vs rendered output, plus layer compositing visualization.

### View Modes (toggle bar)

- **Side by Side** — editor preview and rendered output next to each other (default)
- **Overlay** — rendered output overlaid on editor with opacity slider
- **Layers Stack** — individual layers shown in z-order, toggle visibility per layer

### Editor Preview Panel

Renders the current slide using the same SlideRenderer.svelte component the studio uses. This is the "ground truth" for what the user expects.

### Rendered Output Panel

Composites the layer PNGs from the server into a single preview. Downloads each layer PNG and positions them at their x,y coordinates with proper z-ordering, opacity, and rotation. Native elements show a placeholder overlay.

### Connected Screens

Shows connected display devices (from screens API):
- Device name, type, status (online/offline)
- "Take Screenshot" button — triggers a screenshot from the device (Roku ECP screenshot, or future device APIs)
- Screenshot displayed alongside editor and rendered previews for three-way comparison

### Layer Compositing Order

Bottom visualization showing the z-index stacking order:
- Horizontal bar chart with one bar per layer
- Color-coded by type: PNG layers (green), native (blue outline), failed (red)
- Click a layer bar to highlight it in the preview above
- Legend for colors

### Data Source

- `GET /protocol/slide-layers/{castId}/{slideIndex}` — layer metadata
- `GET /protocol/slide-layer/{castId}/{slideIndex}/{filename}` — layer PNGs
- `GET /api/extensions/slidecast/screens` — connected screens
- `GET /api/extensions/slidecast/casts/{castId}` — cast definition for SlideRenderer
- Roku screenshot: `GET http://{roku_ip}:8060/query/media-player` + screenshot endpoint

## Architecture

### File Structure

```
extensions/slidecast/frontend-routes/slidecast/
├── debug-studio/
│   └── +page.svelte          # Main debug page (tabs, data loading)
├── debug-studio/lib/
│   ├── LayerInspector.svelte  # Tab 1: layer cards grid
│   ├── LayerCard.svelte       # Individual layer card component
│   ├── RenderPipeline.svelte  # Tab 2: queue + errors
│   ├── ScreenPreview.svelte   # Tab 3: comparison views
│   ├── CompareModal.svelte    # Editor vs render comparison modal
│   └── JsonTree.svelte        # Collapsible JSON tree viewer
```

### Component Responsibilities

**+page.svelte** — loads cast definition, manages tab state, passes cast/slide context to child components. Reads `?cast=` and `?slide=` query params on mount.

**LayerInspector** — fetches slide-layers metadata, renders LayerCard grid, handles re-render actions.

**LayerCard** — displays single layer: preview image, metadata, status badge, action buttons. Emits events for compare/rerender/json actions.

**RenderPipeline** — fetches render-status and render-errors, renders KPI cards, slide table, error log. Polls render-status every 5 seconds while tab is active.

**ScreenPreview** — fetches slide-layers PNGs, composites them in a canvas, renders SlideRenderer for editor preview. Manages view mode toggle. Fetches connected screens.

**CompareModal** — side-by-side modal showing editor rendering (SlideRenderer for one element) vs the layer PNG. Used by LayerCard "Compare" button.

**JsonTree** — recursive collapsible JSON viewer. Used by LayerCard "JSON" button.

### Jewel Design Components Used

- `JewelPage` — page container
- `Card` — layer cards, KPI cards
- `Button` — actions
- `Badge` — status badges
- `Modal` — compare modal, JSON viewer
- `DataTable` — slide render status table
- `toasts` — success/error notifications for re-render actions
- Tabs — custom or existing tab pattern from studio

## Studio Help Menu Change

In `studio/+page.svelte` (or `menuActions.js`), add a new Help menu item:

```javascript
{
  label: 'Debug Layers',
  action: () => {
    const url = `/ext/slidecast/debug-studio?cast=${currentCastId}&slide=${currentSlideIndex}`;
    window.open(url, '_blank');
  }
}
```

Place it between "Keyboard Shortcuts" and "Documentation".

## New Backend Endpoint

### `POST /protocol/rerender-element`

Re-renders a single element layer without re-rendering the entire slide.

```json
// Request
{ "castId": "30a20f7c-...", "slideIndex": 0, "elementId": "889b6a8f-..." }

// Response (success)
{ "success": true, "status": "queued", "message": "Element re-render queued" }

// Response (error)
{ "success": false, "error": "Element not found in slide" }
```

Implementation: looks up the element in the cast definition, calls `renderElementViaPage()` for just that element, updates the layer PNG on disk, and refreshes the layers.json metadata.

## Terminology

- "Screen" not "Roku" — the debug tools are device-agnostic
- "Native" means "rendered live by the display device" (not a PNG layer)
- "Rendered" means "server generated a PNG via Playwright"
