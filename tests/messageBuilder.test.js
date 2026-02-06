import {
  buildOrderMessage,
  buildMessagePayload,
  buildTextMessage,
  buildMediaMessage,
  buildCustomFieldMessage,
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
      });
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });
  });

  describe('buildMediaMessage', () => {
    it('should build a media message with defaults', () => {
      const media = { url: 'http://example.com/image.jpg' };
      const message = buildMediaMessage('image', media);

      expect(message).toMatchObject({
        type: 'image',
        media,
        direction: 'outgoing',
        status: 'pending',
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
  });
});
