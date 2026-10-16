# Stage control

A local program uses this plugin to drive the desktop stage. No language model is involved.

The desktop app starts the plugin with the app.

## Build

The package entry is `dist/index.mjs`.

`pnpm -F @proj-airi/stage-tamagotchi run dev` compiles this plugin first.
`pnpm -F @proj-airi/stage-tamagotchi run build` does the same.

Electron then loads `dist/index.mjs` from the package.
The desktop dev command, the desktop build command, and the desktop typecheck command each run that compile.

## Connection

Open Settings, then Connection. Copy the auth token.

The same token is in the server channel config file under the app user data directory. The file name is `server-channel/config.json`.

The default WebSocket URL is `ws://127.0.0.1:6121/ws`.

Send this message first:

```json
{ "type": "module:authenticate", "data": { "token": "<token>" } }
```

Wait for this message:

```json
{ "type": "module:authenticated", "data": { "authenticated": true } }
```

A wrong token gets `{ "type": "error", "data": { "message": "invalid token" } }`. The server then drops commands from that connection.

Send a heartbeat every 20 seconds. The server closes a quiet connection after 60 seconds.

```json
{ "type": "transport:connection:heartbeat", "data": { "kind": "ping", "message": "stage-control", "at": 0 } }
```

The server wraps a forwarded message as `{ "json": { ... } }`. Read `json` when that field exists and `type` does not.

## Command

Send plain JSON:

```json
{ "type": "stage:control", "data": { "requestId": "1", "action": "expression", "name": "happy" } }
```

`requestId` is optional. The result repeats it when you send it.

The plugin answers only the sender:

```json
{ "type": "stage:control:result", "data": { "requestId": "1", "ok": true } }
```

A failure uses the same type:

```json
{ "type": "stage:control:result", "data": { "requestId": "1", "ok": false, "error": "..." } }
```

The server adds `route` and `metadata` when it forwards the result. Your request needs `type` and `data`.

## Actions

### capabilities (call this first)

```json
{ "type": "stage:control", "data": { "requestId": "c", "action": "capabilities" } }
```

Returns `data.actions`: every accepted action with its fields. Each field lists `type`, `required`, and, when set, `min`, `max`, `minLength`, `maxLength`, `pattern`, `integer`, `enum`, and nested `fields`. The list is generated from the plugin's validation schemas, so it always matches what the plugin accepts.

It also returns `data.snapshot`: `modelType`, `view` (`x`, `y`, `z` for VRM, `scale`), `lighting` (VRM only, otherwise `null`), `window.visible` (`null` when the host cannot tell), `live2dMotionGroups`, and `motionLibrary` (`directory`, `vrmaCount`, up to 50 `names`).

An AI client should call `capabilities` once at the start and again after a `model` switch.

### state

Returns `renderer`, `live2dMotionGroups`, `view` when a model is shown, and `lighting` when the renderer is `vrm`.

### expression

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Expression name. |
| `durationMs` | no | Reset delay in milliseconds. It must be greater than 0. |
| `intensity` | no | Strength from 0 to 1. |

Live2D plays the expression even when the character hides it from the agent. Live2D ignores `intensity`. `durationMs` is the time before the expression resets.

VRM names are `happy`, `sad`, `angry`, `surprised`, `neutral`, `think`, and `relaxed`. The default `durationMs` is 3000. The default `intensity` is 1. Intensity 0 returns an error.

Another model type returns an error.

### motion

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Live2D file name or motion group. |
| `index` | no | Integer index, 0 or greater. |

Pass `index` when one group has more than one motion.

A VRM model cannot play a named motion. Use the expression action.

Another model type returns an error.

### speech

| Field | Required | Meaning |
| --- | --- | --- |
| `text` | yes | Caption text. An empty string clears the assistant caption. |
| `speak` | no | Boolean. The default is false. |

The caption window opens first. The line then replaces the assistant caption.

`speak: true` uses the configured speech provider. The result returns when audio is queued. It does not wait until playback ends.

A streaming-only provider returns an error after the caption is visible. Muted speech does the same. Speech that is not configured does the same.

### view

Send at least one of `x`, `y`, `z`, or `scale`. Each value must be a finite number.

Live2D `x` and `y` are percents from the center. The range is -500 to 500. `scale` is a factor from 0.01 to 3. `1` is the original size. `z` returns an error.

VRM `x`, `y`, and `z` are meters from -10 to 10. `scale` sets the camera distance in meters from 0 to 10. `1` is the default distance. A VRM model has no separate scale control.

A value outside the range is clamped.

### model

| Field | Required | Meaning |
| --- | --- | --- |
| `modelId` | yes | Display model id. |

Examples are `preset-live2d-1` and `preset-vrm-1`.

The active character card selects that model. A missing id returns an error.

### vrma

Plays one VRM animation (`.vrma`) on the VRM model. The model fades back to its idle animation when the clip ends.

| Field | Required | Meaning |
| --- | --- | --- |
| `src` | yes | An `http(s)` URL, a `file://` URL, or an absolute path to a `.vrma` file on the computer that runs the desktop app. |
| `loop` | no | Boolean. The default is false. A looping clip plays until the next `vrma` command or a model reload. |
| `fadeInMs` | no | Fade from the current pose, 0 to 10000. The default is 300. |
| `fadeOutMs` | no | Fade back to idle, 0 to 10000. The default is 300. |

```json
{ "type": "stage:control", "data": { "requestId": "2", "action": "vrma", "src": "C:\\Users\\me\\VRMA_MotionPack\\vrma\\VRMA_01.vrma", "fadeInMs": 300, "fadeOutMs": 500 } }
```

The renderer cannot read local files. The plugin reads a local file itself, up to 32 MB, and sends it to the stage as a `data:` URL. The file name must end in `.vrma`. A relative path returns an error.

The result returns when the clip starts. It does not wait until the clip ends.

A Live2D model returns an error. Another model type returns an error.

### light

Changes the VRM scene lighting. VRM only; Live2D returns an error. Every field is optional. Omitted fields keep their value. The change is saved, the same as the VRM settings page.

| Field | Meaning |
| --- | --- |
| `ambient` | `{ intensity?, color? }` |
| `directional` | `{ intensity?, color?, rotationX?, rotationY? }`. Rotation is in degrees. |
| `hemisphere` | `{ intensity?, skyColor?, groundColor? }`. Used when `environment` is `hemisphere`. |
| `environment` | `hemisphere` or `skyBox`. |
| `skyBoxIntensity` | 0 to 1. Used when `environment` is `skyBox`. |
| `exposure` | Renderer tone mapping exposure, 0.1 to 5. `1` is neutral. |

Intensities are clamped to 0-10 and rotations to -180..180. Colors must be `#RRGGBB`; another format returns an error.

The result `data` is the full current lighting. Send `{ "action": "light" }` with no fields to read it without changing anything.

```json
{ "type": "stage:control", "data": { "requestId": "3", "action": "light", "ambient": { "intensity": 0.8, "color": "#ffe8d0" }, "directional": { "intensity": 2.5, "rotationX": -30, "rotationY": 45 }, "exposure": 1.2 } }
```

```json
{ "type": "stage:control:result", "data": { "requestId": "3", "ok": true, "data": { "ambient": { "intensity": 0.8, "color": "#ffe8d0" }, "directional": { "intensity": 2.5, "color": "#fffbf5", "rotationX": -30, "rotationY": 45 }, "hemisphere": { "intensity": 0.4, "skyColor": "#FFFFFF", "groundColor": "#222222" }, "environment": "hemisphere", "skyBoxIntensity": 0.1, "exposure": 1.2 } } }
```

### window

| Field | Required | Meaning |
| --- | --- | --- |
| `visible` | yes | Boolean. |

`true` shows the main window. `false` hides it.

## Motion library

The plugin keeps one library of motions the AI can discover and play:

- `vrma` entries: every `.vrma` file in the motion folder. They play on a VRM model.
- `live2d` entries: the motion groups of the current Live2D model, read from the stage.

Each entry looks like this:

```json
{
  "id": "vrma:VRMA_01.vrma",
  "name": "VRMA_01",
  "type": "vrma",
  "compatibleModels": ["vrm"],
  "source": { "kind": "file", "fileName": "VRMA_01.vrma", "path": "C:\\Users\\me\\AppData\\Roaming\\airi\\motions\\VRMA_01.vrma", "sizeBytes": 123456 },
  "tags": ["greet"],
  "description": "Waves one hand."
}
```

A Live2D entry has `"id": "live2d:<group>:<index>"`, `"type": "live2d"`, `"compatibleModels": ["live2d"]`, and `"source": { "kind": "live2d", "group": "Tap", "index": 0 }`. Its default name is the group, or `<group> <n>` when the group has more than one motion.

### Motion folder

The default folder is `<userData>/motions` (on Windows usually `%APPDATA%\airi\motions`; the plugin logs the folder on start). The plugin creates it.

The folder is chosen in this order:

1. The `AIRI_MOTIONS_DIR` environment variable (absolute path).
2. The folder saved by `motion.setDirectory`, kept in `<userData>/stage-control-motions.json`.
3. The default folder.

The plugin watches the folder. A `.vrma` file you add appears in the library after a short delay (300 ms debounce). A file you remove disappears.

To use an existing folder, such as `D:\airi\vrma`:

```json
{ "type": "stage:control", "data": { "action": "motion.setDirectory", "directory": "D:\\airi\\vrma" } }
```

Send `{ "action": "motion.setDirectory", "reset": true }` to go back to the default folder. In JSON, a Windows path needs `\\`.

### Names, tags, descriptions

The folder holds a sidecar file, `motions.json`:

```json
{
  "version": 1,
  "motions": {
    "VRMA_01.vrma": { "name": "Wave hello", "tags": ["greet", "happy"], "description": "Waves the right hand." },
    "live2d:Tap:0": { "name": "Nod" }
  }
}
```

Keys are `.vrma` file names, or Live2D ids. A missing name falls back to the file name without `.vrma`. You can edit the file by hand or use `motion.rename`.

### Motion actions

All results arrive as `stage:control:result`. Read commands put their output in `data`.

`motion.list` lists motions for the current model type. Pass `"all": true` to list every motion.

```json
{ "type": "stage:control", "data": { "requestId": "l", "action": "motion.list" } }
```

```json
{ "type": "stage:control:result", "data": { "requestId": "l", "ok": true, "data": { "modelType": "vrm", "directory": "...", "motions": [{ "id": "vrma:VRMA_01.vrma", "name": "Wave hello", "type": "vrma", "compatibleModels": ["vrm"], "source": { "kind": "file", "fileName": "VRMA_01.vrma", "path": "...", "sizeBytes": 123456 } }] } } }
```

`modelType` is `vrm`, `live2d`, `disabled`, or `unknown` (the stage did not answer; `warning` then says why).

`motion.play` plays one motion by `id` or `name` (case-insensitive; a file name also works). A `vrma` entry plays through the `vrma` action, a `live2d` entry through the `motion` action. `loop`, `fadeInMs`, and `fadeOutMs` apply to `vrma` entries.

```json
{ "type": "stage:control", "data": { "action": "motion.play", "id": "vrma:VRMA_01.vrma", "loop": false } }
```

```json
{ "type": "stage:control", "data": { "action": "motion.play", "name": "Wave hello" } }
```

```json
{ "type": "stage:control", "data": { "action": "motion.play", "id": "live2d:Tap:0" } }
```

`motion.rename` sets the name, tags, or description. An empty string clears that field.

```json
{ "type": "stage:control", "data": { "action": "motion.rename", "id": "vrma:VRMA_01.vrma", "name": "Wave hello", "tags": ["greet"], "description": "Waves the right hand." } }
```

`motion.upload` saves a `.vrma` file into the motion folder. Send `path` (an absolute path on the machine that runs AIRI) or `base64` with `fileName`. The file must end in `.vrma` and be at most 32 MB. An existing file is kept unless `overwrite` is `true`.

```json
{ "type": "stage:control", "data": { "action": "motion.upload", "path": "D:\\airi\\vrma\\VRMA_03.vrma", "name": "Spin" } }
```

```json
{ "type": "stage:control", "data": { "action": "motion.upload", "fileName": "jump.vrma", "base64": "<base64 or data: URL>", "tags": ["happy"] } }
```

`motion.delete` deletes one `.vrma` file and its metadata. Live2D motions cannot be deleted.

```json
{ "type": "stage:control", "data": { "action": "motion.delete", "id": "vrma:jump.vrma" } }
```

`motion.setDirectory` changes the motion folder, as shown above.

### Library events

When the list changes (a file is added, removed, renamed, uploaded, or the folder changes), the plugin sends this to every peer:

```json
{ "type": "stage:control:event", "data": { "event": "motion.library.changed", "directory": "...", "motions": [] } }
```

`motions` holds the `.vrma` entries. Call `motion.list` for Live2D entries.

### For AI / LLM agents

1. Call `motion.list`. It returns only motions the current model can play.
2. Choose by `name`, `tags`, and `description`.
3. Call `motion.play` with the `id`.
4. Listen for `motion.library.changed`, or call `motion.list` again after a model change.
5. On `ok: false`, read `error`; it names the fix (for example, switch model or pass `id`).

Use `motion.rename` to give motions clear names and tags so later choices are better.

### Stage state

`motion.list` reads the stage with a generic model command, `{ "action": "state" }`. It returns `{ "renderer": "live2d", "live2dMotionGroups": [ { "group": "Tap", "count": 2 } ] }` in `data`. You can send it yourself as a normal `stage:control` action.

## Example

Run this command from the repository root while the desktop app is open:

```sh
node scripts/stage-control-example.mjs --token <token>
```

You can also set `STAGE_CONTROL_URL` and `STAGE_CONTROL_TOKEN`.

The script prints one result for each action. A model can reject an action. The script still prints that error.

## Ownership

The plugin owns the WebSocket session, the payload checks, and command routing.

The plugin also owns the motion library: the folder, the watcher, the sidecar file, upload checks, and the `motion.*` actions.

The desktop app gives the plugin five calls. Those calls read the channel address, run a model command, show or hide the main window, show the caption window, and read the user data folder.

The stage scene applies each model command to the current Live2D or VRM model.
