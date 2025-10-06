# @weni/webchat-service

[![npm version](https://img.shields.io/npm/v/@weni/webchat-service.svg)](https://www.npmjs.com/package/@weni/webchat-service)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Framework-agnostic JavaScript library for Weni WebChat integration. Provides a complete WebSocket-based chat solution with session management, message processing, file handling, and more.

## Features

- ✅ **WebSocket Management**: Automatic connection, reconnection, and ping/pong keepalive
- ✅ **Session Management**: Persistent sessions with localStorage/sessionStorage
- ✅ **Message Processing**: Queue management, delays, and typing indicators
- ✅ **File Handling**: Image compression, base64 conversion, multiple file uploads
- ✅ **Audio Recording**: Built-in audio recording with MP3 conversion
- ✅ **History Management**: Pagination, deduplication, and timestamp sorting
- ✅ **State Management**: Event-driven state updates (no Redux required)
- ✅ **TypeScript Support**: Full type definitions included
- ✅ **Framework Agnostic**: Works with React, Vue, Angular, or vanilla JS

## Installation

```bash
npm install @weni/webchat-service
```

## Quick Start

```javascript
import WeniWebchatService from '@weni/webchat-service'

// Create service instance
const service = new WeniWebchatService({
  socketUrl: 'wss://websocket.weni.ai',
  channelUuid: 'your-channel-uuid',
  host: 'https://flows.weni.ai'
})

// Listen for messages
service.on('message:received', (message) => {
  console.log('New message:', message)
})

// Listen for connection events
service.on('connected', () => {
  console.log('Connected to WebSocket')
})

// Initialize and connect
await service.init()

// Send a message
service.sendMessage('Hello from Weni!')
```

## Configuration

### Basic Configuration

```javascript
const service = new WeniWebchatService({
  // Required
  socketUrl: 'wss://websocket.weni.ai',  // WebSocket server URL
  channelUuid: 'your-channel-uuid',       // Your channel UUID from Weni
  
  // Optional
  host: 'https://flows.weni.ai',          // API host
  connectOn: 'mount',                      // 'mount' or 'manual'
  storage: 'local',                        // 'local' or 'session'
  callbackUrl: '',                         // Callback URL for events
})
```

### Advanced Configuration

```javascript
const service = new WeniWebchatService({
  socketUrl: 'wss://websocket.weni.ai',
  channelUuid: 'your-channel-uuid',
  
  // Connection settings
  autoReconnect: true,                     // Enable auto-reconnection
  maxReconnectAttempts: 30,                // Max reconnection attempts
  reconnectInterval: 3000,                 // Reconnect interval (ms)
  pingInterval: 50000,                     // Ping interval (ms)
  
  // Message settings
  messageDelay: 1000,                      // Delay between messages (ms)
  typingDelay: 2000,                       // Typing indicator delay (ms)
  
  // Cache settings
  autoClearCache: true,                    // Auto-clear cache
  cacheTimeout: 1800000,                   // Cache timeout (30 min)
  
  // File settings
  maxFileSize: 10485760,                   // Max file size (10MB)
  compressImages: true,                    // Compress images
  imageQuality: 0.8,                       // Image quality (0-1)
  
  // Audio settings
  maxDuration: 120000,                     // Max recording duration (2 min)
})
```

## API Reference

### Core Methods

#### `init()`
Initializes the service, restores session, and optionally connects.

```javascript
await service.init()
```

#### `connect()`
Manually connects to WebSocket server.

```javascript
await service.connect()
```

#### `disconnect()`
Disconnects from WebSocket server.

```javascript
service.disconnect()
```

#### `sendMessage(text, options)`
Sends a text message.

```javascript
service.sendMessage('Hello!', {
  metadata: { custom: 'data' }
})
```

#### `sendAttachment(file)`
Sends a file attachment.

```javascript
const file = document.querySelector('input[type="file"]').files[0]
await service.sendAttachment(file)
```

#### `getMessages()`
Gets all messages.

```javascript
const messages = service.getMessages()
```

#### `getHistory(options)`
Fetches message history from server.

```javascript
const history = await service.getHistory({
  limit: 20,
  page: 1
})
```

### Context Management

#### `setContext(context)`
Sets context for messages.

```javascript
service.setContext('user_settings')
```

#### `getContext()`
Gets current context.

```javascript
const context = service.getContext()
```

### Session Management

#### `getSessionId()`
Gets current session ID.

```javascript
const sessionId = service.getSessionId()
```

#### `clearSession()`
Clears session and messages.

```javascript
service.clearSession()
```

### Audio Recording

#### `startRecording()`
Starts audio recording.

```javascript
await service.startRecording()
```

#### `stopRecording()`
Stops recording and sends audio.

```javascript
await service.stopRecording()
```

#### `cancelRecording()`
Cancels recording without sending.

```javascript
service.cancelRecording()
```

### State Management

#### `getState()`
Gets current state.

```javascript
const state = service.getState()
// {
//   messages: [],
//   session: {},
//   connection: { status: 'connected' },
//   context: '',
//   isTyping: false
// }
```

#### `isConnected()`
Checks if connected.

```javascript
if (service.isConnected()) {
  // Do something
}
```

#### `getConnectionStatus()`
Gets connection status.

```javascript
const status = service.getConnectionStatus()
// 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error'
```

## Events

The service uses EventEmitter to notify state changes:

```javascript
// Connection events
service.on('connected', () => {})
service.on('disconnected', () => {})
service.on('reconnecting', (attempts) => {})
service.on('connection:status:changed', (status) => {})

// Message events
service.on('message:received', (message) => {})
service.on('message:sent', (message) => {})

// Typing events
service.on('typing:start', () => {})
service.on('typing:stop', () => {})

// Session events
service.on('session:restored', (session) => {})
service.on('session:cleared', () => {})

// State events
service.on('state:changed', (newState, oldState) => {})
service.on('context:changed', (context) => {})

// Recording events
service.on('recording:started', () => {})
service.on('recording:stopped', (audioData) => {})
service.on('recording:tick', (duration) => {})

// File events
service.on('file:processed', (file) => {})

// History events
service.on('history:loaded', (messages) => {})

// Error events
service.on('error', (error) => {})
```

## Usage with Frameworks

### React

```jsx
import { useEffect, useState } from 'react'
import WeniWebchatService from '@weni/webchat-service'

function Chat() {
  const [messages, setMessages] = useState([])
  const [service] = useState(() => new WeniWebchatService({
    socketUrl: 'wss://websocket.weni.ai',
    channelUuid: 'your-uuid'
  }))

  useEffect(() => {
    service.on('message:received', (message) => {
      setMessages(service.getMessages())
    })

    service.init()

    return () => service.destroy()
  }, [service])

  const handleSend = (text) => {
    service.sendMessage(text)
    setMessages(service.getMessages())
  }

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.text}</div>
      ))}
      <input onKeyPress={(e) => {
        if (e.key === 'Enter') handleSend(e.target.value)
      }} />
    </div>
  )
}
```

### Vue 3

```vue
<template>
  <div>
    <div v-for="msg in messages" :key="msg.id">
      {{ msg.text }}
    </div>
    <input @keypress.enter="handleSend" v-model="input" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import WeniWebchatService from '@weni/webchat-service'

const messages = ref([])
const input = ref('')

const service = new WeniWebchatService({
  socketUrl: 'wss://websocket.weni.ai',
  channelUuid: 'your-uuid'
})

onMounted(async () => {
  service.on('message:received', () => {
    messages.value = service.getMessages()
  })

  await service.init()
})

onUnmounted(() => {
  service.destroy()
})

const handleSend = () => {
  if (input.value.trim()) {
    service.sendMessage(input.value)
    messages.value = service.getMessages()
    input.value = ''
  }
}
</script>
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import WeniWebchatService, { 
  ServiceConfig, 
  Message, 
  ChatState 
} from '@weni/webchat-service'

const config: ServiceConfig = {
  socketUrl: 'wss://websocket.weni.ai',
  channelUuid: 'your-uuid'
}

const service = new WeniWebchatService(config)

service.on('message:received', (message: Message) => {
  console.log(message.text)
})
```

## Development

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Watch Mode

```bash
npm run dev
```

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Modern mobile browsers

Requires WebSocket and EventEmitter support.

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.

---

**Built with ❤️ by Weni**
