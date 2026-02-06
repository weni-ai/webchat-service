import HistoryManager from '../src/modules/HistoryManager';

describe('HistoryManager', () => {
  let historyManager;

  beforeEach(() => {
    // Create a mock websocket with EventEmitter-like behavior
    const mockWebSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    };

    historyManager = new HistoryManager(mockWebSocket);
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
});
