# Contract: voice session

Ships in the second minor of this spec, after the storefront contract is published. It does not change the storefront methods.

## Methods

```text
enterVoiceSession(): Promise<void>
exitVoiceSession(): void
speakIncomingText(text: string, messageId: string): void
```

`enterVoiceSession` rejects, and also emits `voice:error`, when microphone permission is denied or the browser has no capture API. It does not throw a raw `DOMException` to the caller. `speakIncomingText` ignores empty text. `exitVoiceSession` is safe to call from `idle`.

## Events

| Event | Payload |
|-------|---------|
| `voice:state` | `{ state: "idle" \| "listening" \| "speaking" }` |
| `voice:transcript` | `{ text, messageId }` final transcript only |
| `voice:error` | `{ operation: "permission" \| "unsupported" \| "stt" \| "tts", attempt?: number }` |

No audio bytes, tokens, or transcript text are logged. The transcript is on the event so the widget can call `sendMessage`. This library does not call `sendMessage` for it.

## Compatibility

Additive. `sendAudio`, `startRecording`, and `stopRecording` stay the push-to-talk API they are today.
