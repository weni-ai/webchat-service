import EventEmitter from 'eventemitter3';
import HistoryManager from '../src/modules/HistoryManager';
import { SERVICE_EVENTS } from '../src/utils/constants';

function createWebSocketMock() {
  const ws = new EventEmitter();
  ws.send = jest.fn();
  return ws;
}

describe('HistoryManager', () => {
  let historyManager;
  let mockWebSocket;

  beforeEach(() => {
    mockWebSocket = createWebSocketMock();
    historyManager = new HistoryManager(mockWebSocket);
  });

  describe('constructor / config', () => {
    it('should set default config values when no config is provided', () => {
      expect(historyManager.config.defaultLimit).toBe(20);
      expect(historyManager.config.defaultPage).toBe(1);
    });

    it('should accept custom config overrides', () => {
      const ws = createWebSocketMock();
      const manager = new HistoryManager(ws, {
        defaultLimit: 50,
        defaultPage: 3,
      });

      expect(manager.config.defaultLimit).toBe(50);
      expect(manager.config.defaultPage).toBe(3);
    });

    it('should preserve extra config keys via spread', () => {
      const ws = createWebSocketMock();
      const manager = new HistoryManager(ws, { extra: 'value' });

      expect(manager.config.extra).toBe('value');
      expect(manager.config.defaultLimit).toBe(20);
      expect(manager.config.defaultPage).toBe(1);
    });

    it('should initialize loading to false', () => {
      expect(historyManager.loading).toBe(false);
    });

    it('should initialize cachedHistory to an empty array', () => {
      expect(historyManager.cachedHistory).toEqual([]);
    });

    it('should register exactly one listener on the websocket MESSAGE event', () => {
      expect(mockWebSocket.listenerCount(SERVICE_EVENTS.MESSAGE)).toBe(1);
    });
  });

  describe('_registerSocketEventListeners', () => {
    it('should emit HISTORY_RESPONSE with the history payload when websocket emits a history MESSAGE', () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_RESPONSE, listener);

      const history = [{ ID: 'msg-1', message: { type: 'text', text: 'Hi' } }];
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(history);
    });

    it('should not emit HISTORY_RESPONSE for non-history MESSAGE types', () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_RESPONSE, listener);

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'message',
        text: 'Hi',
      });
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, { type: 'starters' });
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, { type: 'voice_tokens' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should send a get_history payload with default limit/page from config', async () => {
      const promise = historyManager.request();

      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'get_history',
        params: {
          limit: 20,
          page: 1,
          before: undefined,
          after: undefined,
        },
      });

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;
    });

    it('should honor custom limit, page, before, and after options', async () => {
      const promise = historyManager.request({
        limit: 50,
        page: 2,
        before: 1700000000,
        after: 1600000000,
      });

      expect(mockWebSocket.send).toHaveBeenCalledWith({
        type: 'get_history',
        params: {
          limit: 50,
          page: 2,
          before: 1700000000,
          after: 1600000000,
        },
      });

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;
    });

    it('should emit HISTORY_LOADING_START synchronously before sending', async () => {
      const events = [];
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_START, () => {
        events.push('loading_start');
      });
      mockWebSocket.send.mockImplementationOnce(() => {
        events.push('send');
      });

      const promise = historyManager.request();

      expect(events).toEqual(['loading_start', 'send']);

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;
    });

    it('should emit HISTORY_REQUESTED with the payload after send', async () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_REQUESTED, listener);

      const promise = historyManager.request({ limit: 10 });

      expect(listener).toHaveBeenCalledWith({
        type: 'get_history',
        params: { limit: 10, page: 1, before: undefined, after: undefined },
      });

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;
    });

    it('should resolve with the processed history on success', async () => {
      const promise = historyManager.request();

      const rawHistory = [
        {
          ID: 'msg-1',
          timestamp: 1700000000,
          direction: 'in',
          message: { type: 'text', text: 'Hello' },
        },
      ];
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: rawHistory,
      });

      const result = await promise;

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'msg-1',
        type: 'text',
        text: 'Hello',
        direction: 'incoming',
        sender: 'response',
      });
    });

    it('should emit HISTORY_LOADING_END after success', async () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_END, listener);

      const promise = historyManager.request();
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should emit HISTORY_LOADED with processed history on success', async () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADED, listener);

      const promise = historyManager.request();
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [
          {
            ID: 'a',
            timestamp: 1,
            direction: 'in',
            message: { type: 'text', text: 'x' },
          },
        ],
      });
      const result = await promise;

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(result);
    });

    it('should reset loading to false after success', async () => {
      const promise = historyManager.request();
      expect(historyManager.loading).toBe(true);

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;

      expect(historyManager.loading).toBe(false);
    });

    it('should reject when called while a previous request is in flight and not call send again', async () => {
      const firstPromise = historyManager.request();
      expect(historyManager.loading).toBe(true);

      await expect(historyManager.request()).rejects.toThrow(
        'History request already in progress',
      );
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1);

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await firstPromise;
    });

    it('should not emit HISTORY_LOADING_START or HISTORY_LOADING_END when the in-flight guard rejects', async () => {
      const startListener = jest.fn();
      const endListener = jest.fn();

      const firstPromise = historyManager.request();

      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_START, startListener);
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_END, endListener);

      await expect(historyManager.request()).rejects.toThrow(
        'History request already in progress',
      );

      expect(startListener).not.toHaveBeenCalled();
      expect(endListener).not.toHaveBeenCalled();

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await firstPromise;
    });

    it('should reject with "History request timeout" after 30 seconds', async () => {
      const promise = historyManager.request();

      jest.advanceTimersByTime(30001);

      await expect(promise).rejects.toThrow('History request timeout');
      expect(historyManager.loading).toBe(false);
    });

    it('should emit HISTORY_LOADING_END on timeout', async () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_END, listener);

      const promise = historyManager.request();
      jest.advanceTimersByTime(30001);

      await expect(promise).rejects.toThrow('History request timeout');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should reject with the original error and emit ERROR + HISTORY_LOADING_END when websocket.send throws', async () => {
      const sendError = new Error('Socket disconnected');
      mockWebSocket.send.mockImplementationOnce(() => {
        throw sendError;
      });

      const errorListener = jest.fn();
      const loadingEndListener = jest.fn();
      historyManager.on(SERVICE_EVENTS.ERROR, errorListener);
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_END, loadingEndListener);

      await expect(historyManager.request()).rejects.toThrow(
        'Socket disconnected',
      );

      expect(errorListener).toHaveBeenCalledWith(sendError);
      expect(loadingEndListener).toHaveBeenCalledTimes(1);
      expect(historyManager.loading).toBe(false);
    });

    // Documents current behavior (not a desired contract):
    // the .once(HISTORY_RESPONSE) listener is not removed on timeout, so a
    // late server response still triggers HISTORY_LOADED + a second
    // HISTORY_LOADING_END. Flagged as a follow-up cleanup opportunity.
    it('documents current behavior: late HISTORY_RESPONSE after timeout still triggers HISTORY_LOADED', async () => {
      const loadedListener = jest.fn();
      const loadingEndListener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADED, loadedListener);
      historyManager.on(SERVICE_EVENTS.HISTORY_LOADING_END, loadingEndListener);

      const promise = historyManager.request();
      jest.advanceTimersByTime(30001);
      await expect(promise).rejects.toThrow('History request timeout');

      expect(loadingEndListener).toHaveBeenCalledTimes(1);
      expect(loadedListener).not.toHaveBeenCalled();

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [
          {
            ID: 'late',
            timestamp: 1,
            direction: 'in',
            message: { type: 'text', text: 'late' },
          },
        ],
      });

      expect(loadedListener).toHaveBeenCalledTimes(1);
      expect(loadingEndListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('processHistory', () => {
    it('should return empty array for non-array input', () => {
      expect(historyManager.processHistory(null)).toEqual([]);
      expect(historyManager.processHistory(undefined)).toEqual([]);
      expect(historyManager.processHistory('string')).toEqual([]);
    });

    it('should return empty array for empty array input', () => {
      expect(historyManager.processHistory([])).toEqual([]);
    });

    it('should normalize a basic text message from history', () => {
      const rawHistory = [
        {
          ID: 'msg-1',
          timestamp: 1700000000,
          direction: 'in',
          message: { type: 'text', text: 'Hello' },
        },
      ];

      const result = historyManager.processHistory(rawHistory);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'msg-1',
        type: 'text',
        text: 'Hello',
        direction: 'incoming',
        sender: 'response',
      });
    });

    it('should normalize direction "out" to "outgoing"', () => {
      const rawHistory = [
        {
          ID: 'msg-1',
          timestamp: 1700000000,
          direction: 'out',
          message: { type: 'text', text: 'Hello' },
        },
      ];

      const result = historyManager.processHistory(rawHistory);

      expect(result[0].direction).toBe('outgoing');
      expect(result[0].sender).toBe('client');
    });

    it('should accept lowercase "id" instead of "ID"', () => {
      const result = historyManager.processHistory([
        {
          id: 'lower-1',
          timestamp: 1700000000,
          direction: 'in',
          message: { type: 'text', text: 'Hi' },
        },
      ]);

      expect(result[0].id).toBe('lower-1');
    });

    it('should default type to "text" when item.message is missing', () => {
      const result = historyManager.processHistory([
        { ID: 'no-msg', timestamp: 1700000000, direction: 'in' },
      ]);

      expect(result[0]).toMatchObject({
        id: 'no-msg',
        type: 'text',
        direction: 'incoming',
      });
      expect(result[0].text).toBeUndefined();
    });

    it('should fall back to Date.now() when timestamp is missing', () => {
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);

      const result = historyManager.processHistory([
        {
          ID: 'no-ts',
          direction: 'in',
          message: { type: 'text', text: 'Hi' },
        },
      ]);

      expect(result[0].timestamp).toBe(1234567890);
      dateNowSpy.mockRestore();
    });

    it('should fall back to Date.now() when timestamp is 0', () => {
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(9999);

      const result = historyManager.processHistory([
        {
          ID: 'zero-ts',
          timestamp: 0,
          direction: 'in',
          message: { type: 'text', text: 'Hi' },
        },
      ]);

      expect(result[0].timestamp).toBe(9999);
      dateNowSpy.mockRestore();
    });

    it('should multiply numeric timestamps by 1000 (seconds to milliseconds)', () => {
      const result = historyManager.processHistory([
        {
          ID: 'ts-1',
          timestamp: 1700000000,
          direction: 'in',
          message: { type: 'text', text: 'Hi' },
        },
      ]);

      expect(result[0].timestamp).toBe(1700000000 * 1000);
    });

    it('should normalize media messages with media_url and caption', () => {
      const result = historyManager.processHistory([
        {
          ID: 'media-1',
          timestamp: 1700000000,
          direction: 'in',
          message: {
            type: 'image',
            media_url: 'https://example.com/img.jpg',
            caption: 'A nice photo',
          },
        },
      ]);

      expect(result[0]).toMatchObject({
        id: 'media-1',
        type: 'image',
        media: 'https://example.com/img.jpg',
        caption: 'A nice photo',
      });
    });

    it('should pass through quick_replies', () => {
      const replies = [{ title: 'Option 1' }, { title: 'Option 2' }];
      const result = historyManager.processHistory([
        {
          ID: 'qr-1',
          timestamp: 1700000000,
          direction: 'in',
          message: {
            type: 'text',
            text: 'Pick one',
            quick_replies: replies,
          },
        },
      ]);

      expect(result[0].quick_replies).toEqual(replies);
    });

    it('should set list_message when list_items has at least one entry', () => {
      const listMessage = {
        list_items: [{ uuid: 'a', title: 'Item A' }],
      };

      const result = historyManager.processHistory([
        {
          ID: 'list-1',
          timestamp: 1700000000,
          direction: 'in',
          message: {
            type: 'interactive',
            text: 'Pick',
            list_message: listMessage,
          },
        },
      ]);

      expect(result[0].list_message).toEqual(listMessage);
    });

    it('should not set list_message when list_items is empty', () => {
      const result = historyManager.processHistory([
        {
          ID: 'list-2',
          timestamp: 1700000000,
          direction: 'in',
          message: {
            type: 'interactive',
            text: 'Pick',
            list_message: { list_items: [] },
          },
        },
      ]);

      expect(result[0].list_message).toBeUndefined();
    });

    it('should not set list_message when list_message has no list_items', () => {
      const result = historyManager.processHistory([
        {
          ID: 'list-3',
          timestamp: 1700000000,
          direction: 'in',
          message: {
            type: 'interactive',
            text: 'Pick',
            list_message: {},
          },
        },
      ]);

      expect(result[0].list_message).toBeUndefined();
    });

    it('should pass through unknown direction values and default sender to "client"', () => {
      const result = historyManager.processHistory([
        {
          ID: 'unk-1',
          timestamp: 1700000000,
          direction: 'unknown',
          message: { type: 'text', text: 'Hi' },
        },
      ]);

      expect(result[0].direction).toBe('unknown');
      expect(result[0].sender).toBe('client');
    });

    describe('interactive messages', () => {
      it('should normalize interactive message with header', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-1',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Choose a product',
              interactive: {
                header: { text: 'Welcome Header' },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0]).toMatchObject({
          id: 'msg-interactive-1',
          type: 'interactive',
          text: 'Choose a product',
          header: 'Welcome Header',
        });
      });

      it('should normalize interactive message with footer', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-2',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Choose a product',
              interactive: {
                footer: { text: 'Tap to select' },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0]).toMatchObject({
          text: 'Choose a product',
          footer: 'Tap to select',
        });
      });

      it('should normalize interactive message with product_list type', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-3',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Browse our products',
              interactive: {
                type: 'product_list',
                action: {
                  name: 'View Products',
                  sections: [
                    {
                      title: 'Featured',
                      product_items: [
                        { product_retailer_id: 'prod-1' },
                        { product_retailer_id: 'prod-2' },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0].product_list).toEqual({
          text: 'Browse our products',
          buttonText: 'View Products',
          sections: [
            {
              title: 'Featured',
              product_items: [
                { product_retailer_id: 'prod-1' },
                { product_retailer_id: 'prod-2' },
              ],
            },
          ],
        });
      });

      it('should normalize interactive message with product_carousel type', () => {
        const productItems = [
          {
            product_retailer_id: '5371#1',
            name: 'Blusa 2',
            price: '10.00',
            image: 'https://imgur.com/DjO2QIa.jpg',
          },
        ];

        const rawHistory = [
          {
            ID: 'msg-interactive-carousel',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Oie',
              interactive: {
                type: 'product_carousel',
                header: { type: 'text', text: 'Coleção Workshirt' },
                footer: { text: 'Footer copy' },
                action: { product_items: productItems },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0]).toMatchObject({
          type: 'interactive',
          text: 'Oie',
          header: 'Coleção Workshirt',
          footer: 'Footer copy',
        });
        expect(result[0].product_carousel).toEqual({
          text: 'Oie',
          product_items: productItems,
        });
        expect(result[0].product_list).toBeUndefined();
      });

      it('should normalize interactive message with header, footer and product_list', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-4',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Our Catalog',
              interactive: {
                type: 'product_list',
                header: { text: 'Catalog Header' },
                footer: { text: 'Catalog Footer' },
                action: {
                  name: 'Browse',
                  sections: [
                    {
                      title: 'All Items',
                      product_items: [{ product_retailer_id: 'item-1' }],
                    },
                  ],
                },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0]).toMatchObject({
          text: 'Our Catalog',
          header: 'Catalog Header',
          footer: 'Catalog Footer',
        });
        expect(result[0].product_list).toEqual({
          text: 'Our Catalog',
          buttonText: 'Browse',
          sections: [
            {
              title: 'All Items',
              product_items: [{ product_retailer_id: 'item-1' }],
            },
          ],
        });
      });

      it('should not set product_list for non-product_list interactive types', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-5',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Select an option',
              interactive: {
                type: 'button',
                action: { buttons: [{ title: 'OK' }] },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0].product_list).toBeUndefined();
        expect(result[0].product_carousel).toBeUndefined();
      });

      it('should not set header/footer when not present in interactive', () => {
        const rawHistory = [
          {
            ID: 'msg-interactive-6',
            timestamp: 1700000000,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Products',
              interactive: {
                type: 'product_list',
                action: { name: 'View', sections: [] },
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0].header).toBeUndefined();
        expect(result[0].footer).toBeUndefined();
      });
    });

    describe('order messages', () => {
      it('should normalize order message with product_items', () => {
        const rawHistory = [
          {
            ID: 'msg-order-1',
            timestamp: 1700000000,
            direction: 'out',
            message: {
              type: 'order',
              order: {
                product_items: [
                  {
                    product_retailer_id: 'prod-1',
                    quantity: 2,
                    item_price: 10.0,
                  },
                  {
                    product_retailer_id: 'prod-2',
                    quantity: 1,
                    item_price: 25.0,
                  },
                ],
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: 'msg-order-1',
          type: 'order',
          direction: 'outgoing',
          sender: 'client',
        });
        expect(result[0].order).toEqual({
          product_items: [
            {
              product_retailer_id: 'prod-1',
              quantity: 2,
              item_price: 10.0,
            },
            {
              product_retailer_id: 'prod-2',
              quantity: 1,
              item_price: 25.0,
            },
          ],
        });
      });

      it('should preserve all product item fields in order', () => {
        const productItems = [
          {
            product_retailer_id: 'abc-123',
            quantity: 3,
            item_price: 15.99,
            currency: 'BRL',
          },
        ];

        const rawHistory = [
          {
            ID: 'msg-order-2',
            timestamp: 1700000000,
            direction: 'out',
            message: {
              type: 'order',
              order: { product_items: productItems },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result[0].order.product_items).toEqual(productItems);
      });
    });

    describe('mixed message types', () => {
      it('should handle a mix of text, interactive, and order messages', () => {
        const rawHistory = [
          {
            ID: 'msg-1',
            timestamp: 1700000001,
            direction: 'in',
            message: { type: 'text', text: 'Hello' },
          },
          {
            ID: 'msg-2',
            timestamp: 1700000002,
            direction: 'in',
            message: {
              type: 'interactive',
              text: 'Pick a product',
              interactive: {
                type: 'product_list',
                header: { text: 'Shop' },
                action: {
                  name: 'View',
                  sections: [
                    {
                      title: 'Items',
                      product_items: [{ product_retailer_id: 'p1' }],
                    },
                  ],
                },
              },
            },
          },
          {
            ID: 'msg-3',
            timestamp: 1700000003,
            direction: 'out',
            message: {
              type: 'order',
              order: {
                product_items: [{ product_retailer_id: 'p1', quantity: 1 }],
              },
            },
          },
        ];

        const result = historyManager.processHistory(rawHistory);

        expect(result).toHaveLength(3);

        // Text message
        expect(result[0]).toMatchObject({
          id: 'msg-1',
          type: 'text',
          text: 'Hello',
        });

        // Interactive message
        expect(result[1]).toMatchObject({
          id: 'msg-2',
          type: 'interactive',
          text: 'Pick a product',
          header: 'Shop',
        });
        expect(result[1].product_list).toBeDefined();

        // Order message
        expect(result[2]).toMatchObject({
          id: 'msg-3',
          type: 'order',
          direction: 'outgoing',
        });
        expect(result[2].order.product_items).toHaveLength(1);
      });
    });
  });

  describe('merge', () => {
    it('should return an empty array when both inputs are empty', () => {
      expect(historyManager.merge([], [])).toEqual([]);
    });

    it('should return only history messages when current is empty', () => {
      const history = [
        { id: 'h1', timestamp: 100 },
        { id: 'h2', timestamp: 200 },
      ];

      const result = historyManager.merge(history, []);

      expect(result).toEqual(history);
    });

    it('should return only current messages when history is empty', () => {
      const current = [
        { id: 'c1', timestamp: 100 },
        { id: 'c2', timestamp: 200 },
      ];

      const result = historyManager.merge([], current);

      expect(result).toEqual(current);
    });

    it('should preserve the current message when overlapping ids exist', () => {
      const history = [{ id: 'shared', timestamp: 100, text: 'old' }];
      const current = [{ id: 'shared', timestamp: 100, text: 'new' }];

      const result = historyManager.merge(history, current);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('new');
    });

    it('should drop messages without id or ID', () => {
      const history = [{ id: 'h1', timestamp: 100 }, { timestamp: 200 }];
      const current = [{ id: 'c1', timestamp: 50 }, { timestamp: 300 }];

      const result = historyManager.merge(history, current);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['c1', 'h1']);
    });

    it('should support a mix of id and ID keys across history and current', () => {
      const history = [
        { ID: 'h-upper', timestamp: 100 },
        { id: 'h-lower', timestamp: 150 },
      ];
      const current = [
        { id: 'c-lower', timestamp: 50 },
        { ID: 'c-upper', timestamp: 75 },
      ];

      const result = historyManager.merge(history, current);

      expect(result).toHaveLength(4);
      expect(result.map((m) => m.id || m.ID)).toEqual([
        'c-lower',
        'c-upper',
        'h-upper',
        'h-lower',
      ]);
    });

    it('should dedupe a current message with uppercase ID against a history id', () => {
      const history = [{ id: 'shared', timestamp: 100, text: 'old' }];
      const current = [{ ID: 'shared', timestamp: 100, text: 'new' }];

      const result = historyManager.merge(history, current);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('new');
    });

    it('should sort merged messages by ascending timestamp', () => {
      const history = [
        { id: 'h1', timestamp: 300 },
        { id: 'h2', timestamp: 100 },
      ];
      const current = [{ id: 'c1', timestamp: 200 }];

      const result = historyManager.merge(history, current);

      expect(result.map((m) => m.id)).toEqual(['h2', 'c1', 'h1']);
    });

    it('should treat missing or zero timestamps as 0 when sorting', () => {
      const history = [
        { id: 'h1', timestamp: 100 },
        { id: 'h2' },
        { id: 'h3', timestamp: 0 },
      ];

      const result = historyManager.merge(history, []);

      expect(result[result.length - 1].id).toBe('h1');
      expect(
        result
          .slice(0, 2)
          .map((m) => m.id)
          .sort(),
      ).toEqual(['h2', 'h3']);
    });

    it('should emit HISTORY_MERGED with counts', () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_MERGED, listener);

      const history = [
        { id: 'h1', timestamp: 1 },
        { id: 'h2', timestamp: 2 },
      ];
      const current = [{ id: 'c1', timestamp: 3 }];
      historyManager.merge(history, current);

      expect(listener).toHaveBeenCalledWith({
        historyCount: 2,
        currentCount: 1,
        mergedCount: 3,
      });
    });

    it('should account for deduplication in mergedCount', () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_MERGED, listener);

      const history = [{ id: 'shared', timestamp: 1 }];
      const current = [{ id: 'shared', timestamp: 1 }];
      historyManager.merge(history, current);

      expect(listener).toHaveBeenCalledWith({
        historyCount: 1,
        currentCount: 1,
        mergedCount: 1,
      });
    });
  });

  describe('findInsertionPosition', () => {
    it('should return 0 for an empty messages array', () => {
      expect(historyManager.findInsertionPosition({ timestamp: 100 }, [])).toBe(
        0,
      );
    });

    it('should return 0 when the new message is older than all existing', () => {
      const messages = [{ timestamp: 200 }, { timestamp: 300 }];

      expect(
        historyManager.findInsertionPosition({ timestamp: 100 }, messages),
      ).toBe(0);
    });

    it('should return messages.length when the new message is newer than all existing', () => {
      const messages = [{ timestamp: 100 }, { timestamp: 200 }];

      expect(
        historyManager.findInsertionPosition({ timestamp: 300 }, messages),
      ).toBe(2);
    });

    it('should return the correct middle index when the new message fits in between', () => {
      const messages = [
        { timestamp: 100 },
        { timestamp: 200 },
        { timestamp: 400 },
      ];

      expect(
        historyManager.findInsertionPosition({ timestamp: 300 }, messages),
      ).toBe(2);
    });

    it('should treat missing timestamps in existing messages as 0', () => {
      const messages = [{}, { timestamp: 100 }];

      expect(
        historyManager.findInsertionPosition({ timestamp: 50 }, messages),
      ).toBe(1);
    });

    it('should fall back to Date.now() when the new message has no timestamp', () => {
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(150);

      const messages = [{ timestamp: 100 }, { timestamp: 200 }];

      expect(historyManager.findInsertionPosition({}, messages)).toBe(1);

      dateNowSpy.mockRestore();
    });
  });

  describe('isUnique', () => {
    it('should return true when the new message has no id or ID', () => {
      expect(historyManager.isUnique({}, [{ id: 'a' }, { id: 'b' }])).toBe(
        true,
      );
    });

    it('should return true when the id is not present in messages', () => {
      expect(
        historyManager.isUnique({ id: 'new' }, [{ id: 'a' }, { id: 'b' }]),
      ).toBe(true);
    });

    it('should return false when id matches an existing id', () => {
      expect(
        historyManager.isUnique({ id: 'a' }, [{ id: 'a' }, { id: 'b' }]),
      ).toBe(false);
    });

    it('should return false when ID (uppercase) matches an existing id', () => {
      expect(
        historyManager.isUnique({ ID: 'a' }, [{ id: 'a' }, { id: 'b' }]),
      ).toBe(false);
    });

    it('should return false when id matches an existing ID (uppercase)', () => {
      expect(
        historyManager.isUnique({ id: 'a' }, [{ ID: 'a' }, { id: 'b' }]),
      ).toBe(false);
    });

    it('should support a mix of id and ID across the existing list', () => {
      const messages = [{ ID: 'upper-1' }, { id: 'lower-1' }];

      expect(historyManager.isUnique({ id: 'lower-1' }, messages)).toBe(false);
      expect(historyManager.isUnique({ id: 'upper-1' }, messages)).toBe(false);
      expect(historyManager.isUnique({ id: 'unrelated' }, messages)).toBe(true);
    });

    it('should return true when messages list is empty regardless of id', () => {
      expect(historyManager.isUnique({ id: 'anything' }, [])).toBe(true);
    });
  });

  describe('removeTemporaryMessages', () => {
    it('should drop messages missing both id and ID', () => {
      const messages = [{ id: 'a' }, {}, { ID: 'b' }, { text: 'no-id' }];

      const result = historyManager.removeTemporaryMessages(messages);

      expect(result).toEqual([{ id: 'a' }, { ID: 'b' }]);
    });

    it('should keep messages with only id', () => {
      const result = historyManager.removeTemporaryMessages([{ id: 'x' }]);

      expect(result).toEqual([{ id: 'x' }]);
    });

    it('should keep messages with only ID (uppercase)', () => {
      const result = historyManager.removeTemporaryMessages([{ ID: 'x' }]);

      expect(result).toEqual([{ ID: 'x' }]);
    });

    it('should return an empty array for empty input', () => {
      expect(historyManager.removeTemporaryMessages([])).toEqual([]);
    });

    it('should return identical content when all messages have IDs', () => {
      const messages = [{ id: 'a' }, { ID: 'b' }, { id: 'c' }];

      const result = historyManager.removeTemporaryMessages(messages);

      expect(result).toEqual(messages);
      expect(result).toHaveLength(3);
    });
  });

  describe('clearCache', () => {
    it('should clear cachedHistory', () => {
      historyManager.cachedHistory = [{ id: 'a' }, { id: 'b' }];

      historyManager.clearCache();

      expect(historyManager.cachedHistory).toEqual([]);
    });

    it('should emit HISTORY_CACHE_CLEARED', () => {
      const listener = jest.fn();
      historyManager.on(SERVICE_EVENTS.HISTORY_CACHE_CLEARED, listener);

      historyManager.clearCache();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLoading', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return false initially', () => {
      expect(historyManager.isLoading()).toBe(false);
    });

    it('should return true while a request is in progress', async () => {
      const promise = historyManager.request();

      expect(historyManager.isLoading()).toBe(true);

      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;
    });

    it('should return false after a request completes', async () => {
      const promise = historyManager.request();
      mockWebSocket.emit(SERVICE_EVENTS.MESSAGE, {
        type: 'history',
        history: [],
      });
      await promise;

      expect(historyManager.isLoading()).toBe(false);
    });

    it('should return false after a request times out', async () => {
      const promise = historyManager.request();
      jest.advanceTimersByTime(30001);
      await expect(promise).rejects.toThrow();

      expect(historyManager.isLoading()).toBe(false);
    });
  });
});
