# Quickstart: PDP Conversation Starters

**Branch**: `001-pdp-starters-bridge` | **Date**: 2026-03-09

## Overview

This feature adds `getStarters()` to `@weni/webchat-service`, enabling webchat-react to request PDP conversation starters over the existing WebSocket connection. No additional configuration is needed.

## Basic Usage

```javascript
import WeniWebchatService from '@weni/webchat-service'

const service = new WeniWebchatService({
  socketUrl: 'wss://websocket.weni.ai',
  channelUuid: 'your-channel-uuid',
})

await service.init()

// Listen for starters
service.on('starters:received', ({ questions }) => {
  // questions: ["Question 1?", "Question 2?", "Question 3?"]
  displayStarters(questions)
})

service.on('starters:error', ({ error }) => {
  // Silently handle — don't show starters
  console.warn('Starters unavailable:', error)
})

// Request starters for a product page
service.getStarters({
  account: 'brandless',
  linkText: 'ipad-10th-gen',
  productName: 'iPad 10th Gen',
  description: 'Versatile tablet with large Retina display...',
  brand: 'Apple',
  attributes: {
    Storage: '64GB, 256GB',
    Color: 'Blue, Silver, Pink',
  },
})
```

## SPA Navigation

When the user navigates between product pages, clear stale starters before requesting new ones:

```javascript
function onPageChange(newUrl) {
  // Clear previous starters immediately
  service.clearStarters()
  clearStartersUI()

  // If new page is a PDP, request starters
  if (isPdpPage(newUrl)) {
    const productData = await getProductDetails(newUrl)
    service.getStarters(productData)
  }
}
```

## Required Fields

Only `account` and `linkText` are required. All other fields enrich the AI-generated questions:

```javascript
// Minimum viable request
service.getStarters({
  account: 'brandless',
  linkText: 'ipad-10th-gen',
})

// Full request with all enrichment fields
service.getStarters({
  account: 'brandless',
  linkText: 'ipad-10th-gen',
  productName: 'iPad 10th Gen',
  description: 'Versatile tablet...',
  brand: 'Apple',
  attributes: { Storage: '64GB, 256GB' },
})
```

## Error Handling

```javascript
// Validation errors are thrown synchronously
try {
  service.getStarters({}) // throws: 'account is required...'
} catch (error) {
  console.error(error.message)
}

// Connection errors are thrown synchronously
try {
  service.getStarters(validData) // throws if not connected
} catch (error) {
  console.error(error.message)
}

// Server errors arrive via event
service.on('starters:error', ({ error }) => {
  // "failed to generate conversation starters: ..."
  // "get pdp starters: concurrency limit reached, try again later"
})
```

## Events Reference

| Event | Payload | When |
|-------|---------|------|
| `starters:received` | `{ questions: string[] }` | Server returns generated questions |
| `starters:error` | `{ error: string }` | Server fails to generate questions |

## Constants

```javascript
import { SERVICE_EVENTS } from '@weni/webchat-service'

service.on(SERVICE_EVENTS.STARTERS_RECEIVED, handler)
service.on(SERVICE_EVENTS.STARTERS_ERROR, handler)
```

## Prerequisites

- Service must be initialized (`await service.init()`)
- WebSocket must be connected (status `'connected'`)
- No additional configuration beyond existing `socketUrl` and `channelUuid`
- Server must have `WWC_LAMBDA_STARTERS_ARN` configured (otherwise requests are silently ignored server-side)
