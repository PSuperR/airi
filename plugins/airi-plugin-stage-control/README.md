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

### window

| Field | Required | Meaning |
| --- | --- | --- |
| `visible` | yes | Boolean. |

`true` shows the main window. `false` hides it.

## Example

Run this command from the repository root while the desktop app is open:

```sh
node scripts/stage-control-example.mjs --token <token>
```

You can also set `STAGE_CONTROL_URL` and `STAGE_CONTROL_TOKEN`.

The script prints one result for each action. A model can reject an action. The script still prints that error.

## Ownership

The plugin owns the WebSocket session, the payload checks, and command routing.

The desktop app gives the plugin four calls. Those calls read the channel address, run a model command, show or hide the main window, and show the caption window.

The stage scene applies each model command to the current Live2D or VRM model.
