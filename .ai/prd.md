# Product Requirements Document (PRD) - Floorview

> This PRD was reconstructed from the existing code (library `src/`, demo app `studio/`) on 2026-11-03. Requirements describe what is built today unless marked **(planned)**. Targets in section 6 are proposals that have not been measured yet.

## 1. Product Overview

### 1.1 Product summary

Floorview is a set of browser tools for creating floor plans of buildings and showing data on them. It has three parts:

- **`@vespenelabs/floorview`**: a framework-free TypeScript library with an SVG floor plan editor (`FloorplanEditor`), an interactive 2D/3D viewer built on Three.js (`FloorplanViewer`) with data layers (room colors, points, heatmaps), and a small, versioned JSON plan format with a validator.
- **Floorview Studio**: a React demo app that uses the library: an editor with a live 3D view and property inspector, an air quality monitoring demo, and an AI import wizard.
- **AI import**: a Claude-based assistant that turns a scanned drawing, blueprint or sketch into a first digital plan through a wizard and a chat. It asks questions when something is unclear and acts as a floor plan specialist with senior architect skills.

### 1.2 Goals

- Let a developer embed a floor plan editor and a 2D/3D viewer in any web app with a few lines of code and no framework lock-in.
- Let a non-designer (e.g., an industrial customer) get a usable digital plan of their facility from an existing paper drawing in minutes instead of drawing it by hand.
- Show live building data (occupancy, sensors, air quality) on the plan as colored rooms, points and heatmaps.
- Keep plans portable: one documented JSON format, validated on every load.

### 1.3 Target users

- **Integrator / developer:** builds a facility, IoT or workplace product and embeds the library. Needs a small, typed API, theming through CSS and predictable behavior.
- **Facility owner or manager (industrial customer):** has a scanned floor plan of a factory, warehouse or office and is not a skilled designer. Uploads the scan, answers a few questions and corrects the draft in the editor.
- **Facility or workplace manager (monitoring):** looks at the plan with data on it (air quality, occupancy) to find problem rooms.

### 1.4 Constraints

- The library must stay free of React and Tailwind. `three` is a peer dependency; its add-ons (OrbitControls, CSS2DRenderer) are bundled.
- Dependencies are kept minimal: a package is added only when the browser, React or existing code cannot reasonably do the job (no state library, router, toast library or linter).
- The Anthropic API key stays on the server. The browser never sees the key, the system prompt or the SDK.
- Third-party floor plan products may inspire features, but no code or assets are copied from them.

## 2. User Problem

- Building a floor plan viewer with 3D, picking, labels and data overlays from scratch takes a team months. Existing products are closed SaaS SDKs with their own hosting and pricing.
- Facility owners usually have their building only as a paper drawing, a PDF scan or a hand sketch. Turning it into a digital plan means hiring a designer or learning CAD software.
- Sensor data (air quality, occupancy) is shown in tables and charts that do not tell the user *where* in the building a problem is.

Floorview solves this with an embeddable editor and viewer, an AI assistant that drafts the plan from the drawing, and data layers that put readings on the plan.

## 3. Functional Requirements

Priority labels: Must (core of the product), Should (important, first to cut), Could (nice to have), Won't (out of scope, see section 4).

### 3.1 Plan data model (Must)

- FR-MOD-01: A plan (`FloorPlan`) has a format version, ID, name and one or more levels. A level has a name, elevation, wall height, walls, rooms and markers.
- FR-MOD-02: A wall has a start and end point, thickness and an optional own height. A room is a polygon (at least 3 points) with a name, optional color and optional metadata. A marker is a point with a name, optional kind, color and metadata.
- FR-MOD-03: All lengths are meters. Plan `y` grows down (as in SVG); in 3D, plan `y` maps to world Z and Y is up.
- FR-MOD-04: `parsePlan` / `parsePlanJSON` validate untrusted input and report errors with the JSON path of the failing field (`PlanValidationError`).
- FR-MOD-05: Plans cross every API boundary as deep copies. The editor and the viewer each keep their own copy.
- FR-MOD-06: Helpers are available for IDs, levels, entity lookup, removal and translation, bounds, area, centroid, point-in-polygon, snapping and angle constraints.
- FR-MOD-07: A sample plan (`createSamplePlan()`, a two-level office) is available for demos and tests.

### 3.2 Floor plan editor (Must)

- FR-EDT-01: The editor draws the active level as SVG on a grid (major lines every 5 m) and fills its container.
- FR-EDT-02: Tools: Select (`V`), Wall (`W`, connected walls click by click), Room (`R`, polygon closed by clicking the first corner, `Enter` or right-click), Marker (`M`) and Pan (`H`).
- FR-EDT-03: Points snap to the grid and to existing wall ends and room corners. `Shift` constrains drawing to 45° steps; `Alt` turns snapping off temporarily.
- FR-EDT-04: Select can move entities and reshape walls and rooms by their handles. A drag is one undo step.
- FR-EDT-05: Undo and redo (snapshot history, 200 steps) with `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` and `Ctrl+Y`. `Delete` removes the selection, `F` fits the level into view, the mouse wheel zooms around the cursor.
- FR-EDT-06: Levels can be added, removed (not the last one), renamed and given an elevation and wall height.
- FR-EDT-07: An underlay image (e.g. a scanned drawing) can be shown under the plan, positioned in plan meters, for tracing. It is not saved in the plan.
- FR-EDT-08: The editor emits events (`change`, selection, tool and level changes) so a host app can follow it.
- FR-EDT-09: All editor colors come from `--vl-*` CSS custom properties, so the host can theme it (light and dark).
- FR-EDT-10: Hosts can draw their own overlay points (e.g. sensors stored outside the plan) on top of the active level with a color and label. The user can select and drag them; the editor reports the dropped position (`overlaypointmove`) without changing the plan or its history.
- FR-EDT-11: `clientToPlan(clientX, clientY)` converts viewport coordinates to a plan position on the active level, so hosts can accept drag-and-drop from outside the editor.
- FR-EDT-12: Hosts can limit the available tools (`tools`) and switch the editor to read-only, where the user can select, pan and zoom but not change the plan.

### 3.3 2D/3D viewer (Must)

- FR-VIEW-01: The viewer renders the plan in 2D (top-down) or 3D (orbit camera) with extruded walls and room floors, and fills its container.
- FR-VIEW-02: It shows one level or all levels stacked by elevation; the default is the active level.
- FR-VIEW-03: Room and marker labels can be shown or hidden. Labels follow the 3D model when the camera moves and never stay behind after a rebuild.
- FR-VIEW-04: Clicking or hovering a room, wall, marker or data point emits `click` / `hover` events with the picked entity. Hover shows a tooltip.
- FR-VIEW-05: Rendering happens on demand (only when something changed), to save battery and CPU. The one exception is visible alert beams (FR-LAY-08), which animate every frame.
- FR-VIEW-06: The background color, an underlay image (textured plane) and `screenshot()` are available. `fitView()` frames the plan.
- FR-VIEW-08: `focus(target)` centers the camera on a data point, room, wall, marker or position (switching level if needed) and highlights it with a ring or outline, e.g. for "Show on floor plan" links.
- FR-VIEW-07: Colors in any CSS syntax (including `hsl()` with spaces and `oklch()`) are converted correctly for Three.js.

### 3.4 Data layers (Must)

- FR-LAY-01: **Room layer:** colors each room from a function of the room (e.g. occupancy, a sensor value), with opacity and tooltip text.
- FR-LAY-02: **Point layer:** draws data points (e.g. sensors) as spheres at plan positions, with color, size and tooltip.
- FR-LAY-03: **Heatmap layer:** interpolates point values over the floor (inverse distance weighting), colors them with configurable color stops and clips the result to rooms.
- FR-LAY-04: Layers are added, replaced and removed by ID. They are re-applied automatically when the plan changes, and an open tooltip refreshes when the layer data changes.
- FR-LAY-05: Point layers can show a persistent text label per point (e.g. a live reading), toggled per layer independently of the plan's room labels, and an outline ring per point (e.g. alert state) separate from the fill color.
- FR-LAY-06: Replacing a points or heatmap layer with new values updates the scene in place (points matched by ID, heatmap texture refilled with a cached room mask), so values can update every 1–5 s for about 100 points without rebuilding the scene. `updateLayer(id, patch)` merges a partial update.
- FR-LAY-07: Points have a shape (sphere, box, cylinder, cone, diamond; layer default, per-point override), so kinds of items (e.g. sensors, gas inlets, consumers) can be told apart. Shapes are solids in 3D and distinct flat glyphs in 2D.
- FR-LAY-08: Points can show an animated alert beam (a light column and pulsing ground ring in 3D, an expanding ring in 2D). The viewer renders continuously only while a beam is visible, and beams are static under `prefers-reduced-motion`.
- FR-LAY-09: A point layer can be hidden and shown (`visible`) without rebuilding, independently of the room name labels.

### 3.5 Floorview Studio: editor page (Must)

- FR-STU-01: The editor page (`#/`) shows the 2D editor, a live 3D viewer and a property inspector side by side; on narrow screens they stack.
- FR-STU-02: The toolbar switches tools, levels, grid and snapping, and (when an underlay exists) shows or hides the scan.
- FR-STU-03: The inspector edits the selection: wall thickness and height (length is read-only); room name, color and capacity (area is read-only); marker name, kind and color. With nothing selected, it edits the active level.
- FR-STU-04: The 3D viewer follows the editor live, has 2D/3D, all levels, labels, occupancy and sensors toggles, and selects the entity in the editor when clicked.
- FR-STU-05: File menu: new plan, load the sample plan, import plan JSON (validated) and export plan JSON. Replacing the plan is undoable.
- FR-STU-06: The plan is autosaved to the browser (`localStorage`) and validated when loaded.
- FR-STU-07: Light and dark themes, dark by default, applied before the first paint. The editor and viewer follow the theme.
- FR-STU-08: A status bar shows hints for the current page and short messages (instead of toasts).

### 3.6 Air quality monitoring demo (Should)

- FR-AQ-01: The air quality page (`#/air-quality`) shows the current plan with one simulated sensor per room.
- FR-AQ-02: Metrics: CO₂, temperature, humidity and PM2.5. Each has color stops, labelled bands (e.g. Good/Moderate/Poor, Cold/Comfortable/Warm) and an ideal value.
- FR-AQ-03: The map shows the selected metric as a heatmap, neutral room floors with value tooltips, and sensor spheres whose tooltip shows all four metrics.
- FR-AQ-04: A time-of-day slider with day playback changes the readings.
- FR-AQ-05: The sidebar shows a legend, a Good/Moderate/Poor summary and the rooms sorted from worst to best (distance from the ideal value).
- FR-AQ-06: The simulation is deterministic (an office day: people drive CO₂, humidity and temperature, the kitchen spikes PM2.5 at lunch, the server room runs hot), so scrubbing is reproducible. Real sensor data can replace it behind the same data shapes.

### 3.7 AI import wizard (Must)

- FR-AI-01: The import page (`#/import`) is a three-step wizard: upload drawing, about the facility, build with the assistant.
- FR-AI-02: Upload accepts PNG, JPG and WebP (PDFs must be exported as an image first). The image is scaled to fit the model's vision limits (2576 px long edge, 3.75 MP), so the agent's pixel coordinates map 1:1 to the stored image.
- FR-AI-03: The facility step asks for the building type (factory, warehouse/logistics, mixed production and offices, office building, other), the number of floors (including mezzanine), one known measurement (optional), what to include (rooms and areas, machines and equipment, exits and doors, loading docks, fire safety equipment) and free-text notes.
- FR-AI-04: The assistant step shows a chat next to a live preview. Before the first draft the preview shows the scan; after it, the draft over the scan in 2D or 3D with see-through floors and an adjustable scan opacity.
- FR-AI-05: The assistant behaves as a floor plan specialist and senior industrial architect. When something essential is unclear (scale, floors, ambiguous areas) it asks multiple-choice questions (`ask_user`); the user can pick an option or answer freely.
- FR-AI-06: The assistant drafts complete plans (`propose_floor_plan`) in image pixels plus a scale (meters per pixel) and explains where the scale came from. Rooms carry a use (production, warehouse, loading, office, meeting, canteen, sanitary, technical, lab, circulation, other) that sets their color. It lists its assumptions.
- FR-AI-07: Every draft is validated and converted in the browser. Errors (implausible scale, malformed walls or rooms, empty levels) go back to the assistant as error results so it can correct them. Warnings (walls outside the image, overlapping rooms, tiny rooms dropped) are shown and sent to the assistant.
- FR-AI-08: After each valid draft, the assistant receives an image of its plan drawn over the scan, so it can check the alignment itself and fix it. The automatic loop is limited to 6 steps per user message.
- FR-AI-09: The user can correct the plan in plain words ("the warehouse is the whole right side", "add 4 loading docks on the south wall"). Every revision appears as a new draft version.
- FR-AI-10: Progress is visible while the assistant works: a thinking status line with short summaries, and "Drafting the plan… N kB" while the plan is written. The user can stop a reply and retry after an error.
- FR-AI-11: **Use this plan** loads the draft into the editor (undoable) with the scan as a toggleable underlay for tracing corrections.
- FR-AI-12: Errors are shown in plain language: missing credentials, rate limits (retryable), rejected requests with the API's own message (e.g. low credit balance), service unavailable (retryable).
- FR-AI-13: A scripted offline mode (`npm run dev:mock`) demos the whole flow without an API key. It does not read the drawing.

### 3.8 AI import server (Must)

- FR-SRV-01: `POST /api/architect` streams one model turn as NDJSON events (`text`, `thinking`, `tool_progress`, `done`, `error`). It is served by the Vite dev and preview servers.
- FR-SRV-02: The agent definition (system prompt, tools) lives only on the server (`/architect/server`) and is kept byte-stable, because it is the cached prompt prefix.
- FR-SRV-03: The browser runs the tool loop and keeps the conversation append-only: assistant turns are replayed exactly as returned.
- FR-SRV-04: Requests are limited to 25 MB. When the browser disconnects (Stop, closed tab), generation is aborted.
- FR-SRV-05: Model settings: `claude-opus-5-5`, adaptive thinking with summarized display, effort `high`, streaming with eager tool-input streaming, automatic prompt caching and server-side fallback for requests declined by a safety classifier.
- FR-SRV-06: The key is read from `ANTHROPIC_API_KEY` (environment or `studio/.env.local`) or an `ant auth login` profile.

### 3.9 Embeddable AI architect (Must)

- FR-ARC-01: The assistant is part of the library, so other apps can embed it: `@vespenelabs/floorview/architect` (browser, no React) and `@vespenelabs/floorview/architect/server` (Node, framework-free). Studio uses these exports.
- FR-ARC-02: `ArchitectController` runs the tool loop headlessly (append-only conversation, `ask_user`, proposal conversion and validation, preview image sent back to the model) and exposes immutable state snapshots and `change`/`proposal` events.
- FR-ARC-03: The transport is pluggable; `createFetchTransport` lets the host choose the URL, headers and credentials (e.g. a session cookie).
- FR-ARC-04: `runArchitectTurn(request, model, options)` yields one turn's events so any server framework can stream NDJSON; `createArchitectMiddleware` wraps it for Node `http`/Connect.
- FR-ARC-05: The model is provider-agnostic behind `ArchitectModel`. `createAnthropicArchitectModel({ client | apiKey, model })` uses `@anthropic-ai/sdk` as an optional peer dependency; `createMockArchitectModel` serves the scripted assistant for host tests and e2e.
- FR-ARC-06: Hosts add domain guidance with `extraInstructions`, appended to the system prompt after the cached agent prompt.
- FR-ARC-07: The server helper enforces request limits (message count, total image bytes, image count, text size) and reports violations as 413 (malformed requests as 400) before streaming.

### 3.9 Non-functional requirements

- NFR-01: TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnused*`, `verbatimModuleSyntax`) for the library and the studio.
- NFR-02: The library builds to ES and UMD bundles with CSS and type declarations.
- NFR-03: Library logic (model, geometry, editor, scene building, heatmap, plan conversion) is covered by automated tests (Vitest, jsdom). The viewer is tested through `sceneBuilder`, because jsdom has no WebGL.
- NFR-04: The viewer needs WebGL; the editor is plain SVG.
- NFR-05: Browser support: latest two versions of Chrome, Edge, Firefox and Safari.
- NFR-06: The studio works down to mobile width (360 px) without horizontal scrolling.
- NFR-07: Accessible UI: labelled controls, keyboard operation of menus and forms (Base UI primitives), visible focus.
- NFR-08: No secrets in the browser bundle (checked for the SDK, key handling and prompt).

## 4. Product Boundaries

### 4.1 In scope

- Library: plan model and validator, editor, 2D/3D viewer, room/point/heatmap layers, underlay, theming through CSS variables.
- Studio: editor page, air quality demo, AI import wizard with a dev-server endpoint and a mock mode.
- Documentation in `README.md` and `docs/`.

### 4.2 Out of scope (today)

- Hosting, user accounts and authentication.
- A production server for `/api/architect` (a static studio build has no endpoint).
- Real sensor integration (the air quality and occupancy data are simulated).
- Saving plans to a server or sharing them between users; the browser stores one plan.
- Saving the underlay scan with the plan (it is lost on reload).
- PDF upload (only images), DXF/IFC/CAD import and export.
- Doors and windows as wall openings, furniture, dimensions and annotations.
- Multi-select, copy and paste.
- Translations (English only) and imperial units (meters only).

### 4.3 Planned (roadmap ideas from `docs/architecture.md`)

- Openings (doors and windows) as wall-attached entities, with cut-outs in 3D.
- Multi-select, copy and paste, room detection from enclosing walls.
- Icon layers, a camera API (`flyTo(entity)`) and entity highlighting.
- Incremental scene updates and instancing for large point layers.
- DXF/IFC import.
- A hostable `/api/architect` behind authentication and rate limits.

### 4.4 Assumptions and open questions

- A1: The AI draft is a starting point, not a measured survey. Accuracy depends on the drawing quality and the scale information; the user is expected to check and correct it in the editor.
- A2: Every AI request spends API credit. Before the endpoint is exposed outside development it needs authentication, rate limits and a cost budget per user.
- A3: The underlay is session-only. Open question: should the scan be stored with the plan (it can be several MB) or in separate storage?
- A4: Open question: should multi-floor imports be supported from one drawing with several floors, or one drawing per floor?
- A5: Open question: is the air quality page a demo only, or the start of a monitoring product with real sensors?
- A6: The plan format is version 1. Any breaking change needs a new version and a migration in `parsePlan`.

## 5. User Stories

### 5.1 Embedding the library

- ID: US-001
- Title: Embed the editor and viewer
- Description: As a developer, I want to add an editor and a viewer to my app with a few lines of code so that I don't have to build floor plan tools myself.
- Acceptance Criteria:
  - `new FloorplanEditor(element, { plan })` and `new FloorplanViewer(element, { plan, mode })` render into the given elements and fill them.
  - Wiring `editor.on('change', p => viewer.setPlan(p))` keeps the viewer in sync.
  - `dispose()` removes all DOM elements, listeners and GPU resources.

- ID: US-002
- Title: Load a plan safely
- Description: As a developer, I want plans from storage or users to be validated so that broken data does not crash my app.
- Acceptance Criteria:
  - `parsePlanJSON` returns a typed plan for valid input.
  - Invalid input raises `PlanValidationError` with the JSON path of the problem (e.g. `levels[0].rooms[2].points`).

- ID: US-003
- Title: Theme the components
- Description: As a developer, I want the editor and viewer to match my app's light and dark themes.
- Acceptance Criteria:
  - Editor colors change when the `--vl-*` CSS variables change.
  - `viewer.setBackground()` changes the 3D background.
  - Data-driven room colors are not overridden by the theme.

### 5.2 Editing a plan

- ID: US-010
- Title: Draw walls
- Description: As a user, I want to draw connected walls by clicking corners so that I can outline a building quickly.
- Acceptance Criteria:
  - With the Wall tool, each click adds a wall from the previous point; clicking the same point twice, right-click or `Esc` stops.
  - Points snap to the grid and to existing wall ends; `Shift` constrains to 45°; `Alt` disables snapping.

- ID: US-011
- Title: Draw rooms
- Description: As a user, I want to draw rooms as polygons so that areas have names, colors and sizes.
- Acceptance Criteria:
  - The room closes on a click on the first corner, `Enter` or right-click, with at least 3 points; `Esc` cancels.
  - The inspector shows the room's area in m².

- ID: US-012
- Title: Place markers
- Description: As a user, I want to place markers (machines, exits, sensors) so that important equipment is on the plan.
- Acceptance Criteria:
  - With the Marker tool, a click places a marker; its name, kind and color can be edited in the inspector.

- ID: US-013
- Title: Move and reshape
- Description: As a user, I want to move entities and drag their corners so that I can fix mistakes without redrawing.
- Acceptance Criteria:
  - Dragging a selected entity moves it by grid steps; dragging a handle reshapes a wall or room.
  - One drag is one undo step.

- ID: US-014
- Title: Undo and redo
- Description: As a user, I want to undo and redo changes so that I can experiment safely.
- Acceptance Criteria:
  - `Ctrl/⌘+Z` undoes and `Ctrl/⌘+Shift+Z` or `Ctrl+Y` redoes, up to 200 steps, including plan replacement from import or the AI wizard.

- ID: US-015
- Title: Work with several levels
- Description: As a user, I want to add floors with their own elevation and height so that multi-storey buildings are modeled.
- Acceptance Criteria:
  - Levels can be added, renamed, removed (except the last) and given an elevation and wall height.
  - Removing the active level switches to another level without errors.

- ID: US-016
- Title: Trace over a scan
- Description: As a user, I want my scanned drawing under the plan so that I can trace and correct walls.
- Acceptance Criteria:
  - The underlay is shown under the grid and plan, does not capture clicks and can be toggled in the toolbar.
  - `F` fits the underlay when the level is empty.

### 5.3 Viewing a plan

- ID: US-020
- Title: Switch between 2D and 3D
- Description: As a user, I want to see the plan from above or in 3D so that I understand the building.
- Acceptance Criteria:
  - The 2D/3D toggle changes the camera; in 3D the user can orbit, pan and zoom.
  - The view can show the active level or all levels.

- ID: US-021
- Title: Labels that stay with the model
- Description: As a user, I want room labels to stay on their rooms so that the plan is readable from any angle.
- Acceptance Criteria:
  - Labels move with the model when the camera rotates.
  - After a change in the editor, no duplicate or frozen labels remain.

- ID: US-022
- Title: Select from the 3D view
- Description: As a user, I want to click a room in the 3D view to edit it.
- Acceptance Criteria:
  - Clicking a room, wall or marker selects it in the editor and the inspector shows its properties.

### 5.4 Data on the plan

- ID: US-030
- Title: Color rooms by data
- Description: As a facility manager, I want rooms colored by a value (e.g. occupancy) so that I see busy areas at a glance.
- Acceptance Criteria:
  - The occupancy toggle colors rooms; hovering a room shows its value.

- ID: US-031
- Title: See sensors
- Description: As a facility manager, I want to see sensors on the plan with their readings.
- Acceptance Criteria:
  - Sensors are spheres at their positions; hovering shows the readings.
  - Sensors are not hidden under room labels.

- ID: US-032
- Title: Air quality heatmap
- Description: As a facility manager, I want a heatmap of CO₂, temperature, humidity or PM2.5 so that I can see where air quality is poor.
- Acceptance Criteria:
  - Selecting a metric shows its heatmap clipped to rooms, with a legend of its bands.
  - The time slider and playback change the readings during the day.
  - The room list is sorted worst first and shows a Good/Moderate/Poor badge per room.
  - The page works when opened directly by URL.

### 5.5 AI import

- ID: US-040
- Title: Upload a drawing
- Description: As an industrial customer, I want to upload a photo or scan of my floor plan so that I don't have to draw it myself.
- Acceptance Criteria:
  - PNG, JPG and WebP files can be dropped or picked; other files show a clear message (PDF: export as an image).
  - Large images are scaled down to the model's limits without changing their proportions.

- ID: US-041
- Title: Describe the facility
- Description: As an industrial customer, I want to tell the assistant what kind of building it is and one measurement I know so that it asks fewer questions and gets the scale right.
- Acceptance Criteria:
  - Building type, floors, known measurement, what to include and notes can be entered; only type and floors are required.
  - The answers are sent to the assistant with the drawing.

- ID: US-042
- Title: Answer the assistant's questions
- Description: As an industrial customer, I want the assistant to ask me when something is unclear so that the draft matches my building.
- Acceptance Criteria:
  - Questions appear as multiple-choice options with a free-text answer.
  - The assistant asks only about things it cannot read from the drawing.

- ID: US-043
- Title: Review a draft over the scan
- Description: As an industrial customer, I want to see the draft on top of my drawing so that I can check that walls and rooms are in the right place.
- Acceptance Criteria:
  - The draft is shown over the scan with see-through floors; the scan opacity is adjustable; 2D and 3D are available.
  - The draft version number increases with each revision.
  - The assistant summarizes the draft, its scale source and its assumptions.

- ID: US-044
- Title: Correct the draft in the chat
- Description: As an industrial customer, I want to describe corrections in plain words so that I don't have to use the editor for big changes.
- Acceptance Criteria:
  - A message like "add 4 loading docks on the south wall" produces a new draft with the change.
  - Invalid drafts are not shown; the assistant fixes them itself.

- ID: US-045
- Title: Use the plan
- Description: As an industrial customer, I want to move the final draft to the editor so that I can fine-tune it.
- Acceptance Criteria:
  - "Use this plan" loads the draft into the editor with the scan as an underlay and opens the editor page.
  - Undo restores the previous plan.

- ID: US-046
- Title: Understand failures
- Description: As a user, I want clear messages when the assistant is unavailable so that I know whether to retry.
- Acceptance Criteria:
  - Missing credentials, rate limits, rejected requests (with the API's own reason) and outages are shown in plain language.
  - Retryable errors offer a Retry button; Stop ends a running reply.

- ID: US-047
- Title: Demo without an API key
- Description: As a developer or salesperson, I want to demo the import flow without credentials.
- Acceptance Criteria:
  - With `npm run dev:mock`, the wizard asks questions, proposes a generic factory and summarizes it, and the result can be used in the editor.

### 5.6 Studio basics

- ID: US-050
- Title: Keep my work
- Description: As a user, I want my plan to survive a page reload.
- Acceptance Criteria:
  - The plan is saved in the browser after every change and restored, validated, on load. An invalid saved plan falls back to the sample.

- ID: US-051
- Title: Import and export plan files
- Description: As a user, I want to save my plan as a file and open it later or elsewhere.
- Acceptance Criteria:
  - Export downloads the plan as JSON; import validates the file and shows an error for an invalid one.

- ID: US-052
- Title: Dark and light theme
- Description: As a user, I want a dark theme by default and the option to switch.
- Acceptance Criteria:
  - The app opens in dark mode without a flash of the light theme; the choice is remembered.

- ID: US-053
- Title: Mobile width
- Description: As a user on a small screen, I want the studio to stay usable.
- Acceptance Criteria:
  - At 360 px width the panels stack and there is no horizontal page scroll.

## 6. Success Metrics

### 6.1 Product criteria and measurement (proposed)

| ID | Metric | Target | How it is measured |
| --- | --- | --- | --- |
| SM-01 | Library correctness | All tests and type checks pass on every change | `npm test` and `npm run typecheck` |
| SM-02 | Integration effort | A developer shows a plan in the editor and viewer in under 15 minutes from the README | Timed trial with developers new to the library |
| SM-03 | Viewer performance | 60 fps orbiting in 3D for a plan with 200 rooms and 500 sensor points on a mid-range laptop | Browser performance profile with a generated plan |
| SM-04 | AI import time | First draft within 3 minutes of upload for a typical factory drawing | Timestamps in the studio between upload and first `propose_floor_plan` |
| SM-05 | AI import quality | At least 80% of rooms in the right place, and the scale within 5% when one measurement is given | Comparison with hand-drawn reference plans for a set of test drawings |
| SM-06 | Correction effort | A non-designer gets an acceptable plan of their facility in under 30 minutes (wizard plus editor) | Moderated usability test with at least 3 industrial users |
| SM-07 | Questions asked | At most 3 rounds of questions before the first draft | Count of `ask_user` calls per import |
| SM-08 | Cost per import | Average API cost per completed import below an agreed budget | Usage reported by the API per conversation |

### 6.2 Metrics after release

- Share of started imports that end with "Use this plan".
- Number of chat corrections per import and editor edits in the first session after import.
- Number of apps and plans using the library.
