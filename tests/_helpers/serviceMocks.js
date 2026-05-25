/**
 * Shared test helpers for WeniWebchatService tests.
 *
 * Centralizes the boilerplate that was previously duplicated across
 * service.test.js, WebSocketManager.test.js and starters.test.js.
 *
 * NOTE: This file is intentionally placed under `tests/_helpers/` so that
 * Jest's `testMatch` glob (`**\/tests/**\/*.test.js`) does NOT pick it up
 * as a test suite.
 */

import WeniWebchatService from '../../src/index';

/**
 * Installs jest-friendly browser globals (localStorage, sessionStorage and
 * WebSocket) into the current jsdom environment. Idempotent across
 * beforeEach calls.
 *
 * @returns {void}
 */
export function installBrowserMocks() {
  global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };

  global.sessionStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };

  global.WebSocket = jest.fn().mockImplementation(() => makeOpenSocketMock());
  global.WebSocket.OPEN = 1;
  global.WebSocket.CONNECTING = 0;
  global.WebSocket.CLOSING = 2;
  global.WebSocket.CLOSED = 3;
}

/**
 * Returns a freshly initialized WebSocket-like mock with the given
 * readyState. Defaults to OPEN (1).
 *
 * The mock supports both the `onopen`/`onmessage`/`onerror`/`onclose`
 * direct-assignment API used by `WebSocketManager.connect()` AND the
 * `addEventListener`/`removeEventListener` API used by the queued-send
 * branch of `WebSocketManager.send()`.
 *
 * @param {number} [readyState=1] One of WebSocket.{CONNECTING,OPEN,CLOSING,CLOSED}
 * @returns {Object} Mock WebSocket instance
 */
export function makeOpenSocketMock(readyState = 1) {
  const listeners = { open: [], error: [], close: [], message: [] };
  return {
    readyState,
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn((event, cb) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: jest.fn((event, cb) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((fn) => fn !== cb);
    }),
    listeners,
    fire(event, ...args) {
      (listeners[event] || []).slice().forEach((cb) => cb(...args));
    },
  };
}

/**
 * Builds a default valid service config. Override individual fields by
 * passing a partial config.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function makeConfig(overrides = {}) {
  return {
    socketUrl: 'wss://test.example.com',
    channelUuid: '12345',
    ...overrides,
  };
}

/**
 * Creates a `WeniWebchatService` and forces it into the connected state by
 * stubbing the WebSocket layer. Useful for tests that need to exercise
 * runQueue / send paths without driving the real handshake.
 *
 * @param {Object} [overrides] Partial config overrides
 * @returns {{ service: WeniWebchatService, socket: Object }}
 */
export function createConnectedService(overrides = {}) {
  const service = new WeniWebchatService(makeConfig(overrides));
  const socket = makeOpenSocketMock();
  service.websocket.socket = socket;
  service.websocket.status = 'connected';
  service._connected = true;
  return { service, socket };
}
