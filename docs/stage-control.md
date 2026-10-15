# External stage control

An authenticated program on this computer can drive the desktop character.
The program sends `stage:control` on the channel WebSocket.
No language model is involved.
Only the main character window applies the command.
The window returns `stage:control:result` to the sender.

## Requirements

Before you send a command, start the desktop app.
Open the character stage.
A hidden main window still applies commands.
A settings preview does not apply commands.

Before you use external control, set a token in Settings, under Connection.
That token is the channel token.
An empty token still requires the authenticate message.
With an empty token, any authenticate token succeeds.
Set a token when other local programs must not control the stage.

## Address

The default address is `ws://127.0.0.1:6121/ws`.
The path is `/ws`.
`SERVER_CHANNEL_PORT` changes the port.
The default port is 6121.
Settings, under Connection, can change the host.
When TLS is on, use `wss` instead of `ws`.

## Messages

Send plain JSON text.
Each message has `type` and `data`.

```json
{ "type": "stage:control", "data": {} }
```

The server can answer with SuperJSON.
A SuperJSON message has `json` and optional `meta`.
Read `json` when `json.type` is a string.
Plain JSON has `type` at the top level.

## Authenticate

Send this message first.

```json
{
  "type": "module:authenticate",
  "data": { "token": "<token>" }
}
```

A successful answer has type `module:authenticated`.
`data.authenticated` is `true`.

A wrong token returns an error event.
The message is `invalid token`.

A command before authenticate returns an error event.
The message is `not authenticated`.

## Result

Every command uses type `stage:control`.
`data.action` selects the command.
`data.id` is the caller correlation id.
Use a new id for each command.
The result echoes that id.

The stage sends the result only to the sender.
The result type is `stage:control:result`.

Success:

```json
{
  "type": "stage:control:result",
  "data": { "id": "<id>", "ok": true }
}
```

Failure:

```json
{
  "type": "stage:control:result",
  "data": { "id": "<id>", "ok": false, "error": "<message>" }
}
```

A bad payload still returns a result when the stage receives the event.
The stage logs the same error text.
An unsupported model type returns an error.
The stage does not crash.

## Expression

This command sets the expression on the loaded Live2D or VRM model.

```json
{
  "type": "stage:control",
  "data": {
    "id": "expression-1",
    "action": "expression",
    "name": "happy",
    "duration": 2,
    "intensity": 1
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `expression` |
| `name` | yes | Exact expression name. It must not be empty. |
| `duration` | no | Live2D seconds before the default expression returns. The value must be greater than 0. VRM ignores it. |
| `intensity` | no | VRM weight. The value must be greater than 0 and at most 1. The default is 1. Live2D ignores it. |

Live2D names come from the loaded model, for example `05_Angry`.
VRM names are `happy`, `sad`, `angry`, `surprised`, `neutral`, `think`, and `relaxed`.
A missing Live2D name returns an error.
An unknown VRM name returns an error.
Other model types return an error.
The expression does not change.

## Motion

This command plays one Live2D motion.
VRM has no named motion.
A VRM command returns an error.
The idle loop continues.

```json
{
  "type": "stage:control",
  "data": {
    "id": "motion-1",
    "action": "motion",
    "group": "Idle",
    "index": 0
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `motion` |
| `file` | no | Live2D motion file name. This field wins when `group` is also set. |
| `group` | no | Cubism motion group. The stage uses it when `file` is absent. |
| `index` | no | Index inside `group`. The default is 0. Use a whole number of 0 or greater. |

Set `file` or `group`.
A missing motion returns an error.
Other model types return an error.

You can send a file name instead of a group.

```json
{
  "type": "stage:control",
  "data": {
    "id": "motion-2",
    "action": "motion",
    "file": "idle_01.motion3.json"
  }
}
```

## Caption

This command shows a line in the caption window.
Empty `text` clears the assistant caption.

```json
{
  "type": "stage:control",
  "data": {
    "id": "caption-1",
    "action": "caption",
    "text": "Hello from stage control.",
    "speak": false
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `caption` |
| `text` | yes | Caption text. Use a string. Empty text clears the assistant caption. |
| `speak` | no | When true, the stage also speaks the line. The default is false. |

Open the caption window to see the line.
The desktop caption stays for 10 seconds.
Speech uses the speech provider of the active character.
When speech is muted, the caption stays visible.
The error is `Speech is muted. The caption is visible.`
When speech is not set, the caption stays visible.
The error is `Speech is not configured. The caption is visible.`
Speech waits until playback ends.
One speech request stops after 60 seconds.

## Transform

This command moves the loaded model.
Live2D can also change scale.
VRM has no model scale.

```json
{
  "type": "stage:control",
  "data": {
    "id": "transform-1",
    "action": "transform",
    "x": 0,
    "y": 0,
    "scale": 1
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `transform` |
| `x` | no | Horizontal position. |
| `y` | no | Vertical position. |
| `z` | no | VRM depth, in meters. Live2D rejects this field. |
| `scale` | no | Live2D scale factor. VRM rejects this field. |

Set at least one of `x`, `y`, `z`, or `scale`.
Each value must be a finite number.

Live2D `x` and `y` are percentages from the screen center.
The range is -500 to 500.
Live2D `scale` runs from 0.01 to 3.
`1` is the original size.
A Live2D `z` value fails the whole command.
No axis changes.

VRM `x`, `y`, and `z` are meters from the scene origin.
The range is -10 to 10.
A VRM `scale` value fails the whole command.
No axis changes.

The view control clamps a value outside the range.
Other model types return an error.
The model does not move.

A VRM move uses `x`, `y`, and `z`.

```json
{
  "type": "stage:control",
  "data": {
    "id": "transform-2",
    "action": "transform",
    "x": 0,
    "y": 0,
    "z": 0
  }
}
```

## Model

This command selects a display model by id.
The result means the selection is stored.
The model can still be loading.
This command changes the selected model for the app.

```json
{
  "type": "stage:control",
  "data": {
    "id": "model-1",
    "action": "model",
    "modelId": "preset-live2d-1"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `model` |
| `modelId` | yes | Display model id. It must not be empty. |

| `modelId` | Model |
| --- | --- |
| `preset-live2d-1` | Hiyori (Pro) |
| `preset-live2d-2` | Hiyori (Free) |
| `preset-vrm-1` | AvatarSample_A |
| `preset-vrm-2` | AvatarSample_B |

Imported models use their own ids.
An unknown id returns `Display model "<id>" was not found.`

## Window

This command shows or hides the main character window.
Hide does not close the app.
The stage keeps the WebSocket connection.

```json
{
  "type": "stage:control",
  "data": {
    "id": "window-show",
    "action": "window",
    "visible": true
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Caller correlation id. |
| `action` | yes | `window` |
| `visible` | yes | `true` shows and focuses the window. `false` hides it. |

A minimized window is restored, then shown and focused.
The stage web app has no main window.
That runtime returns `This runtime cannot show or hide the main window.`

Hide the window with `visible` set to `false`.

```json
{
  "type": "stage:control",
  "data": {
    "id": "window-hide",
    "action": "window",
    "visible": false
  }
}
```

## Example

From the repository root, run this command.

```sh
node scripts/stage-control-example.mjs
```

`AIRI_WS_URL` sets the address.
The default is `ws://127.0.0.1:6121/ws`.
`AIRI_TOKEN` sets the token.
The default is an empty token.
`AIRI_STAGE_HIDE=1` hides the main window after the other commands.
Edit the action list at the top of the script.
Expression names and motion groups depend on the loaded model.
The model command in the script selects `preset-live2d-1`.

## Model support

Expression, motion, and transform support Live2D and VRM.
Spine, tachie, MMD, Godot, and an unloaded model return an error for those actions.
Caption, model selection, and the window command still run.
