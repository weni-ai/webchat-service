import {
  buildOrderMessage,
  buildMessagePayload,
  buildTextMessage,
  buildMediaMessage,
  buildCustomFieldMessage,
  buildFileMessage,
  buildLocationMessage,
  buildQuickReplyMessage,
  buildConversationStatusMessage,
  buildWebSocketMessage,
  buildRegistrationMessage,
  buildHistoryRequest,
  buildTypingMessage,
} from '../src/utils/messageBuilder';

describe('messageBuilder', () => {
  describe('buildOrderMessage', () => {
    const productItems = [
      { product_retailer_id: 'prod-1', quantity: 2, item_price: 10.0 },
      { product_retailer_id: 'prod-2', quantity: 1, item_price: 25.0 },
    ];

    it('should build an order message with required fields', () => {
      const message = buildOrderMessage(productItems);

      expect(message).toMatchObject({
        type: 'order',
        direction: 'outgoing',
        status: 'pending',
        order: {
          product_items: productItems,
        },
      });
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });

    it('should generate a unique id', () => {
      const message1 = buildOrderMessage(productItems);
      const message2 = buildOrderMessage(productItems);

      expect(message1.id).not.toBe(message2.id);
    });

    it('should use provided id from options', () => {
      const message = buildOrderMessage(productItems, { id: 'custom-id' });

      expect(message.id).toBe('custom-id');
    });

    it('should use provided timestamp from options', () => {
      const timestamp = 1700000000000;
      const message = buildOrderMessage(productItems, { timestamp });

      expect(message.timestamp).toBe(timestamp.toString());
    });

    it('should convert timestamp to string', () => {
      const message = buildOrderMessage(productItems);

      expect(typeof message.timestamp).toBe('string');
    });

    it('should use provided direction from options', () => {
      const message = buildOrderMessage(productItems, {
        direction: 'incoming',
      });

      expect(message.direction).toBe('incoming');
    });

    it('should use provided status from options', () => {
      const message = buildOrderMessage(productItems, {
        status: 'delivered',
      });

      expect(message.status).toBe('delivered');
    });

    it('should preserve all product item properties', () => {
      const items = [
        {
          product_retailer_id: 'abc-123',
          quantity: 3,
          item_price: 15.99,
          currency: 'BRL',
        },
      ];

      const message = buildOrderMessage(items);

      expect(message.order.product_items).toEqual(items);
    });
  });

  describe('buildMessagePayload', () => {
    const sessionId = 'test-session-123';

    describe('order message type', () => {
      it('should build payload for order message', () => {
        const orderMessage = {
          type: 'order',
          timestamp: '1700000000000',
          order: {
            product_items: [{ product_retailer_id: 'prod-1', quantity: 1 }],
          },
        };

        const payload = buildMessagePayload(sessionId, orderMessage);

        expect(payload).toMatchObject({
          type: 'message',
          message: {
            type: 'order',
            timestamp: '1700000000000',
            order: {
              product_items: [{ product_retailer_id: 'prod-1', quantity: 1 }],
            },
          },
          from: sessionId,
          context: '',
        });
      });

      it('should include context when provided', () => {
        const orderMessage = {
          type: 'order',
          timestamp: '1700000000000',
          order: { product_items: [{ product_retailer_id: 'prod-1' }] },
        };

        const payload = buildMessagePayload(sessionId, orderMessage, {
          context: 'test-context',
        });

        expect(payload.context).toBe('test-context');
      });

      it('should use message_with_fields type when custom fields present', () => {
        const orderMessage = {
          type: 'order',
          timestamp: '1700000000000',
          order: { product_items: [{ product_retailer_id: 'prod-1' }] },
          __customFields: { field1: 'value1' },
        };

        const payload = buildMessagePayload(sessionId, orderMessage);

        expect(payload.type).toBe('message_with_fields');
        expect(payload.data).toEqual({ field1: 'value1' });
      });
    });

    describe('text message type', () => {
      it('should build payload for text message', () => {
        const textMessage = { type: 'text', text: 'Hello' };

        const payload = buildMessagePayload(sessionId, textMessage);

        expect(payload).toMatchObject({
          type: 'message',
          message: { type: 'text', text: 'Hello' },
          from: sessionId,
        });
      });

      it('switches to message_with_fields and forwards data when text has __customFields', () => {
        const textMessage = {
          type: 'text',
          text: 'Hi',
          __customFields: { utm: 'source-x' },
        };

        const payload = buildMessagePayload(sessionId, textMessage);

        expect(payload.type).toBe('message_with_fields');
        expect(payload.data).toEqual({ utm: 'source-x' });
        expect(payload.message).toEqual({ type: 'text', text: 'Hi' });
      });

      it('keeps the message type when __customFields is an empty object', () => {
        const textMessage = {
          type: 'text',
          text: 'Hi',
          __customFields: {},
        };

        const payload = buildMessagePayload(sessionId, textMessage);

        expect(payload.type).toBe('message');
        expect(payload.data).toBeUndefined();
      });

      it('keeps the message type when __customFields is null', () => {
        const textMessage = {
          type: 'text',
          text: 'Hi',
          __customFields: null,
        };

        const payload = buildMessagePayload(sessionId, textMessage);

        expect(payload.type).toBe('message');
        expect(payload.data).toBeUndefined();
      });

      it('keeps the message type when __customFields is not an object', () => {
        const textMessage = {
          type: 'text',
          text: 'Hi',
          __customFields: 'not an object',
        };

        const payload = buildMessagePayload(sessionId, textMessage);

        expect(payload.type).toBe('message');
        expect(payload.data).toBeUndefined();
      });
    });

    describe('media message type', () => {
      it('should build payload for image message', () => {
        const imageMessage = {
          type: 'image',
          media: { url: 'http://example.com/image.jpg' },
        };

        const payload = buildMessagePayload(sessionId, imageMessage);

        expect(payload).toMatchObject({
          type: 'message',
          message: {
            type: 'image',
            media: { url: 'http://example.com/image.jpg' },
          },
        });
      });

      it.each(['image', 'video', 'audio', 'file'])(
        'should build payload for %s message preserving the type',
        (type) => {
          const message = { type, media: { url: `http://x/${type}` } };

          const payload = buildMessagePayload(sessionId, message);

          expect(payload.type).toBe('message');
          expect(payload.message).toEqual({
            type,
            media: { url: `http://x/${type}` },
          });
          expect(payload.from).toBe(sessionId);
        },
      );

      it('switches to message_with_fields when media has __customFields', () => {
        const imageMessage = {
          type: 'image',
          media: { url: 'http://x/y.jpg' },
          __customFields: { source: 'pdp' },
        };

        const payload = buildMessagePayload(sessionId, imageMessage);

        expect(payload.type).toBe('message_with_fields');
        expect(payload.data).toEqual({ source: 'pdp' });
      });
    });

    describe('set_custom_field message type', () => {
      it('should build payload for set_custom_field message', () => {
        const customFieldMessage = {
          type: 'set_custom_field',
          data: { key: 'name', value: 'John' },
        };

        const payload = buildMessagePayload(sessionId, customFieldMessage);

        expect(payload).toEqual({
          type: 'set_custom_field',
          data: { key: 'name', value: 'John' },
        });
      });
    });

    describe('invalid message type', () => {
      it('should throw error for unsupported message type', () => {
        const invalidMessage = { type: 'unknown_type' };

        expect(() => buildMessagePayload(sessionId, invalidMessage)).toThrow(
          'Invalid message type',
        );
      });
    });
  });

  describe('buildTextMessage', () => {
    it('should build a text message with defaults', () => {
      const message = buildTextMessage('Hello');

      expect(message).toMatchObject({
        type: 'text',
        text: 'Hello',
        direction: 'outgoing',
        status: 'pending',
        metadata: {},
        hidden: false,
      });
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });

    it('honors every option override', () => {
      const message = buildTextMessage('Hello', {
        id: 'custom-id',
        timestamp: 1700000000000,
        direction: 'incoming',
        status: 'delivered',
        metadata: { source: 'history' },
        hidden: true,
      });

      expect(message).toEqual({
        id: 'custom-id',
        type: 'text',
        text: 'Hello',
        timestamp: 1700000000000,
        direction: 'incoming',
        status: 'delivered',
        metadata: { source: 'history' },
        hidden: true,
      });
    });

    it('generates a unique id per call when not provided', () => {
      const a = buildTextMessage('Hello');
      const b = buildTextMessage('Hello');

      expect(a.id).not.toBe(b.id);
    });
  });

  describe('buildMediaMessage', () => {
    it('should build a media message with defaults', () => {
      const media = { url: 'http://example.com/image.jpg' };
      const message = buildMediaMessage('image', media);

      expect(message).toMatchObject({
        type: 'image',
        media,
        text: '',
        direction: 'outgoing',
        status: 'pending',
        metadata: {},
      });
    });

    it('honors caption + every option override', () => {
      const message = buildMediaMessage(
        'video',
        { url: 'x' },
        {
          id: 'mid',
          caption: 'A nice clip',
          timestamp: 1700000000000,
          direction: 'incoming',
          status: 'delivered',
          metadata: { from: 'history' },
        },
      );

      expect(message).toEqual({
        id: 'mid',
        type: 'video',
        media: { url: 'x' },
        text: 'A nice clip',
        timestamp: 1700000000000,
        direction: 'incoming',
        status: 'delivered',
        metadata: { from: 'history' },
      });
    });
  });

  describe('buildCustomFieldMessage', () => {
    it('should build a custom field message', () => {
      const message = buildCustomFieldMessage('name', 'John');

      expect(message).toEqual({
        type: 'set_custom_field',
        data: { key: 'name', value: 'John' },
        status: 'pending',
      });
    });

    it('preserves non-string values verbatim', () => {
      const message = buildCustomFieldMessage('cart_count', 3);
      expect(message.data).toEqual({ key: 'cart_count', value: 3 });
    });
  });

  // ---------------------------------------------------------------------------
  // buildFileMessage — previously uncovered. Defaults + caption-like filename
  // handling + metadata merge are the load-bearing branches.
  // ---------------------------------------------------------------------------
  describe('buildFileMessage', () => {
    it('builds a file message with sensible defaults', () => {
      const message = buildFileMessage('https://x/y.pdf');

      expect(message).toMatchObject({
        type: 'file',
        media: 'https://x/y.pdf',
        text: 'file',
        direction: 'outgoing',
        status: 'pending',
      });
      expect(message.metadata.filename).toBeUndefined();
      expect(message.metadata.size).toBeUndefined();
      expect(message.metadata.mimeType).toBeUndefined();
      expect(message.id).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });

    it('uses provided filename for the visible text label', () => {
      const message = buildFileMessage('https://x/y.pdf', {
        filename: 'invoice.pdf',
      });
      expect(message.text).toBe('invoice.pdf');
    });

    it('merges file-level metadata with extra metadata fields', () => {
      const message = buildFileMessage('https://x/y.pdf', {
        filename: 'doc.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        metadata: { source: 'history', uploader: 'agent' },
      });

      expect(message.metadata).toEqual({
        filename: 'doc.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        source: 'history',
        uploader: 'agent',
      });
    });

    it('honors id, timestamp, direction and status overrides', () => {
      const message = buildFileMessage('https://x/y.pdf', {
        id: 'fid',
        timestamp: 1234,
        direction: 'incoming',
        status: 'delivered',
      });

      expect(message).toMatchObject({
        id: 'fid',
        timestamp: 1234,
        direction: 'incoming',
        status: 'delivered',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // buildLocationMessage — previously uncovered.
  // ---------------------------------------------------------------------------
  describe('buildLocationMessage', () => {
    it('builds a location message with defaults', () => {
      const message = buildLocationMessage(-23.55, -46.63);

      expect(message).toMatchObject({
        type: 'location',
        direction: 'outgoing',
        status: 'pending',
      });
      expect(message.metadata.latitude).toBe(-23.55);
      expect(message.metadata.longitude).toBe(-46.63);
      expect(message.metadata.address).toBeUndefined();
      expect(message.id).toBeDefined();
    });

    it('includes the address and merges extra metadata when provided', () => {
      const message = buildLocationMessage(10, 20, {
        address: '123 Main St',
        metadata: { source: 'gps' },
      });

      expect(message.metadata).toEqual({
        latitude: 10,
        longitude: 20,
        address: '123 Main St',
        source: 'gps',
      });
    });

    it('honors id, timestamp, direction and status overrides', () => {
      const message = buildLocationMessage(0, 0, {
        id: 'lid',
        timestamp: 1234,
        direction: 'incoming',
        status: 'delivered',
      });

      expect(message).toMatchObject({
        id: 'lid',
        timestamp: 1234,
        direction: 'incoming',
        status: 'delivered',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // buildQuickReplyMessage — previously uncovered. Note: defaults for direction
  // and status are 'incoming'/'delivered' (server-style row).
  // ---------------------------------------------------------------------------
  describe('buildQuickReplyMessage', () => {
    const replies = [{ title: 'Yes' }, { title: 'No' }];

    it('builds a quick reply message with defaults', () => {
      const message = buildQuickReplyMessage('Pick one', replies);

      expect(message).toMatchObject({
        type: 'text',
        text: 'Pick one',
        quick_replies: replies,
        direction: 'incoming',
        status: 'delivered',
        metadata: {},
      });
      expect(message.id).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });

    it('honors id, timestamp, direction, status and metadata overrides', () => {
      const message = buildQuickReplyMessage('Pick one', replies, {
        id: 'qid',
        timestamp: 1234,
        direction: 'outgoing',
        status: 'pending',
        metadata: { source: 'agent' },
      });

      expect(message).toEqual({
        id: 'qid',
        type: 'text',
        text: 'Pick one',
        quick_replies: replies,
        timestamp: 1234,
        direction: 'outgoing',
        status: 'pending',
        metadata: { source: 'agent' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // buildOrderMessage — already partially covered. Add coverage for the
  // timestamp-coercion branch when timestamp is explicitly 0 (falsy) so the
  // `options.timestamp || Date.now()` guard takes the right side.
  // ---------------------------------------------------------------------------
  describe('buildOrderMessage — extra branches', () => {
    it('falls back to Date.now() when timestamp is explicitly 0 and stringifies', () => {
      const before = Date.now();
      const message = buildOrderMessage(
        [{ product_retailer_id: 'p', quantity: 1 }],
        { timestamp: 0 },
      );
      const after = Date.now();

      expect(typeof message.timestamp).toBe('string');
      const parsed = Number(message.timestamp);
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
    });
  });

  // ---------------------------------------------------------------------------
  // buildConversationStatusMessage — defaults + override branches.
  // ---------------------------------------------------------------------------
  describe('buildConversationStatusMessage', () => {
    it('builds an incoming, persisted status row with defaults', () => {
      const message = buildConversationStatusMessage('All good', 'success');

      expect(message).toMatchObject({
        type: 'conversation_status',
        text: 'All good',
        statusType: 'success',
        direction: 'incoming',
        persisted: true,
        metadata: {},
      });
      expect(message.id).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });

    it('honors id, timestamp, direction and metadata overrides (persisted stays true)', () => {
      const message = buildConversationStatusMessage('Heads up', 'info', {
        id: 'sid',
        timestamp: 1234,
        direction: 'outgoing',
        metadata: { variant: 'banner' },
      });

      expect(message).toEqual({
        id: 'sid',
        type: 'conversation_status',
        text: 'Heads up',
        statusType: 'info',
        timestamp: 1234,
        direction: 'outgoing',
        persisted: true,
        metadata: { variant: 'banner' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // buildWebSocketMessage — exercised indirectly elsewhere; pin the contract
  // (including how it forwards options vs. defaults) so payload drift breaks
  // tests immediately.
  // ---------------------------------------------------------------------------
  describe('buildWebSocketMessage', () => {
    it('returns the empty-options envelope (context defaults to "")', () => {
      const payload = buildWebSocketMessage('message', { type: 'text' });

      expect(payload).toEqual({
        type: 'message',
        message: { type: 'text' },
        context: '',
        from: undefined,
        session_type: undefined,
        callback: undefined,
        token: undefined,
        trigger: undefined,
        data: undefined,
      });
    });

    it('forwards every supported option field', () => {
      const payload = buildWebSocketMessage(
        'message',
        { type: 'text' },
        {
          context: 'ctx',
          from: 'sess',
          session_type: 'local',
          callback: 'cb',
          token: 'tok',
          trigger: 'tr',
          data: { extra: true },
        },
      );

      expect(payload).toEqual({
        type: 'message',
        message: { type: 'text' },
        context: 'ctx',
        from: 'sess',
        session_type: 'local',
        callback: 'cb',
        token: 'tok',
        trigger: 'tr',
        data: { extra: true },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // buildRegistrationMessage — defaults + every override branch including the
  // `data` conditional.
  // ---------------------------------------------------------------------------
  describe('buildRegistrationMessage', () => {
    it('builds with defaults when no options are provided', () => {
      const payload = buildRegistrationMessage('sess-1');

      expect(payload).toEqual({
        type: 'register',
        from: 'sess-1',
        callback: '',
        session_type: 'local',
        token: undefined,
      });
    });

    it('honors callback, session_type and token overrides', () => {
      const payload = buildRegistrationMessage('sess-1', {
        callback: 'https://cb',
        session_type: 'remote',
        token: 'tok-1',
      });

      expect(payload.callback).toBe('https://cb');
      expect(payload.session_type).toBe('remote');
      expect(payload.token).toBe('tok-1');
    });

    it('attaches the data field only when provided', () => {
      const without = buildRegistrationMessage('sess-1');
      expect('data' in without).toBe(false);

      const withData = buildRegistrationMessage('sess-1', {
        data: { trigger: 'pdp' },
      });
      expect(withData.data).toEqual({ trigger: 'pdp' });
    });
  });

  // ---------------------------------------------------------------------------
  // buildHistoryRequest — previously uncovered.
  // ---------------------------------------------------------------------------
  describe('buildHistoryRequest', () => {
    it('returns the documented defaults when called with no options', () => {
      expect(buildHistoryRequest()).toEqual({
        type: 'get_history',
        limit: 20,
        page: 1,
        before: undefined,
        after: undefined,
      });
    });

    it('honors limit and page overrides', () => {
      expect(buildHistoryRequest({ limit: 50, page: 3 })).toEqual({
        type: 'get_history',
        limit: 50,
        page: 3,
        before: undefined,
        after: undefined,
      });
    });

    it('forwards before/after cursors when provided', () => {
      expect(
        buildHistoryRequest({ before: 'msg-100', after: 'msg-50' }),
      ).toMatchObject({ before: 'msg-100', after: 'msg-50' });
    });

    it('falls back to defaults when limit/page are 0 (falsy)', () => {
      const payload = buildHistoryRequest({ limit: 0, page: 0 });
      expect(payload.limit).toBe(20);
      expect(payload.page).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // buildTypingMessage — previously uncovered.
  // ---------------------------------------------------------------------------
  describe('buildTypingMessage', () => {
    it.each([true, false])(
      'returns { type: "typing", isTyping: %p }',
      (isTyping) => {
        expect(buildTypingMessage(isTyping)).toEqual({
          type: 'typing',
          isTyping,
        });
      },
    );
  });
});
