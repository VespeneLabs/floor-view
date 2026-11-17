# Plan commands

Plan commands describe changes to a plan as plain JSON: "add a wall here", "move this marker", "remove that pipeline". They are meant for anything that edits a plan without a pointer, such as an AI assistant's tool calls, a script or an import. The library validates and applies them; it does not run a model or a chat. Everything here is in `@vespenelabs/floorview/model` (pure: no DOM, no three) and re-exported from the main entry.

```ts
import { applyPlanCommands, describePlan, PLAN_COMMAND_DEFINITIONS } from '@vespenelabs/floorview/model';

const result = applyPlanCommands(plan, [
  { type: 'addWall', levelId: 'ground', start: { x: 0, y: 8 }, end: { x: 10, y: 8 } },
  { type: 'addMarker', levelId: 'ground', id: 'tank', position: { x: 2, y: 2 }, model: 'gas/tank' },
  { type: 'addMarker', levelId: 'ground', id: 'panel', position: { x: 8, y: 6 } },
  { type: 'addPipeline', levelId: 'ground', from: 'tank', to: 'panel', medium: 'N2' }, // routed automatically
], { assets, media });

if (result.ok) save(result.plan); // result.created: [{ index, kind, id, levelId }, ...]
else show(result.errors);         // [{ index, type?, message }, ...]
```

In an editor, `editor.applyCommands(commands, { media? })` does the same on the editor's plan as **one undo step** (see [Editor](editor.md)).

## Commands

Lengths are meters; `x` grows right and `y` grows down (see [Data model](data-model.md)).

| `type` | Properties | Notes |
| --- | --- | --- |
| `setPlanName` | `name` | |
| `addLevel` | `id?`, `name?`, `elevation?`, `height?` | Without an elevation the level is stacked on top. |
| `updateLevel` | `levelId`, `name?`, `elevation?`, `height?` | |
| `removeLevel` | `levelId` | Not the last level. |
| `addWall` | `levelId`, `id?`, `start`, `end`, `thickness?` (0.15), `height?` | |
| `addRoom` | `levelId`, `id?`, `name?`, `points` (3 or more), `color?`, `data?` | A room does not create walls. |
| `addMarker` | `levelId`, `id?`, `name?`, `position`, `kind?`, `color?`, `model?`, `rotation?`, `scale?`, `elevation?`, `pipelineId?`, `data?` | The default name is the model's name with a number ("Tank 3"). `pipelineId` makes it a fitting: it moves onto the pipe. |
| `addPipeline` | `levelId`, `id?`, `name?`, `points?`, `from?`, `to?`, `elevation?` (2.6), `diameter?`, `medium?`, `color?`, `data?` | With `points` (`{ x, y, z? }`, `z` defaults to `elevation`) the route is given; without them `from` and `to` (marker ids) are required and the route is found with `routePipeline`. Linked ends move onto their markers. |
| `updateEntity` | `kind`, `id`, `levelId?`, `patch` | `patch` holds only the properties to change; `null` removes an optional one. The id cannot be changed. |
| `moveEntity` | `kind`, `id`, `levelId?`, `dx`, `dy` | Moves the whole entity. |
| `removeEntity` | `kind`, `id`, `levelId?` | Links to it are cleared. |

- **Ids.** Add commands take an optional `id`, unique in the plan, so a later command in the same list can refer to what an earlier one created (a level, the two markers of a pipeline). Without it an id is generated; either way it is reported in `created`.
- **`levelId` on entities is optional**, because ids are unique in a plan.
- The TypeScript type is `PlanCommand`; `applyPlanCommands` takes `unknown[]`, since commands are usually untrusted.

## Validation and errors

`applyPlanCommands(plan, commands, { assets?, media?, maxCommands? })` never changes the plan it is given and never throws for bad commands.

- **All or nothing.** Commands are applied in order to a copy. If every command is valid, the result is `{ ok: true, plan, created }`. Otherwise it is `{ ok: false, errors }` with one entry per invalid command: its `index`, its `type` and a `message`. The remaining commands are still checked, so one round reports every error (a command that depends on a failed one fails too).
- **Messages are written to be acted on**, by a person or a model: `There is no level "L9". Levels: "ground" (Ground floor).`, `"w1" is a wall, not a room.`, `thickness: expected a positive number.`, `addRoom has no property "colour". Properties: levelId, id, name, points, color, data.`
- **What is checked:** the shape of each command (unknown types and properties are errors), the plan format's own rules for the entity (`parseEntity`: finite numbers, positive thickness and diameter, 3 room points, 2 different pipeline points), a wall with no length, a room with no area, ids that are taken, levels and entities that don't exist, links (`from`, `to`, `pipelineId`) that don't resolve on the level, and, with `assets`, unknown model ids (similar ids are suggested). Geometry is otherwise not judged: overlapping walls or a marker outside every room are allowed.
- **`assets`** (a list or a `Map` by id) is the model catalog. Without it any model id is accepted. Fittings are centered on their pipe by the model's height, as in the editor.
- **`media`** (`PipeMedium[]`, e.g. `GAS_MEDIA`): a `medium` that matches a preset by id or name, ignoring case, becomes its id and gives the pipeline its color, default diameter and name ("Nitrogen 2"). Other media stay free text.
- **`maxCommands`** (default 500) bounds a list.
- Marker rotations are normalized to 0-360. After the commands, pipeline ends and fittings follow their links (`syncPipelineLinks`).
- An error with `index: -1` is about the list as a whole (not an array, too long, editor read-only).

## Tool definitions

`PLAN_COMMAND_DEFINITIONS` has one entry per command: `{ type, name, description, input_schema }`, where `name` is a tool name (`add_wall`, `update_entity`…) and `input_schema` is the JSON Schema of the command without its `type`. The entries are plain JSON and can be handed to a model as tools, next to the host's own:

```ts
import { PLAN_COMMAND_DEFINITIONS, planCommandFromTool } from '@vespenelabs/floorview/model';

const tools = [...PLAN_COMMAND_DEFINITIONS.map(({ name, description, input_schema }) => ({ name, description, input_schema })), ...myTools];

// For each tool call of the model:
const command = planCommandFromTool(call.name, call.input); // null: not a plan command, one of yours
if (command) {
  const result = editor.applyCommands([command]);
  toolResult = result.ok ? `Done. ${JSON.stringify(result.created)}` : result.errors.map((e) => e.message).join('\n');
}
```

`PLAN_COMMANDS_TOOL` is the alternative: a single tool `apply_plan_commands` whose input is `{ commands: [...] }`, each command with its `type`. One call is then one all-or-nothing change and one undo step, which suits requests like "add a room with four walls". Return the errors with their indexes as the tool result so the model can correct the list.

Pick one of the two styles per agent. The definitions are stable data: keep them in the same order so a provider's prompt cache keeps working.

## Describing a plan

`describePlan(plan, { levelId?, detail?, assets? })` returns a compact text description for prompts and tool results: every entity with its id, name and rounded coordinates, room areas, the room a marker is in, pipeline lengths and links. It leaves out `data` and is several times smaller than the plan JSON.

```
Plan "Works": 1 level. Lengths in meters; x grows right, y grows down (seen from above).

Level "Ground" [L1]: floor at 0 m, wall height 3 m, extent x 0..10, y 0..8
Rooms (1):
- r1 "Hall" 80 m²: (0,0) (10,0) (10,8) (0,8)
Walls (1): id start->end thickness [height]
- w1 (0,0)->(10,0) 0.2
Markers (2):
- m1 "Tank 1" at (2,2) in "Hall" model kit/tank (Tank)
- m2 "Tank 2" at (8,6) in "Hall" model kit/tank (Tank)
Pipelines (1): points are (x,y,z)
- p "Nitrogen 1" medium N2 diameter 0.08 length 6 m from m1: (2,2,2.6) (8,2,2.6)
```

- `levelId` describes one level and lists the others by name.
- `detail: 'summary'` keeps the rooms and replaces the lists of walls, markers and pipelines with counts ("Markers: 99 (40 × Tank, 12 × sensor)"), for large plans.
- `assets` adds model names next to model ids.

The plan changes with every edit, so put the description in a message or tool result, not in a cached system prompt.

## Building an editing assistant

The library has no editing agent of its own. A host builds one from these parts: the tool definitions above, `describePlan` for context, `editor.applyCommands` to execute, and its own chat UI, endpoint and prompt. The model adapter and stream helpers of the AI architect can be reused for the model call: see [AI architect, "Your own agent"](architect.md#your-own-agent).
