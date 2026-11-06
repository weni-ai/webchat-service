import { evaluateBackInStockOffer } from '../src/modules/backInStock/offer';

function item(
  itemId: string,
  quantity: number | null,
  sellers?: Array<Record<string, unknown>>,
) {
  return {
    itemId,
    sellers: sellers ?? [
      {
        sellerId: '1',
        sellerDefault: true,
        commertialOffer: { AvailableQuantity: quantity },
      },
    ],
  };
}

describe('evaluateBackInStockOffer', () => {
  it('is unavailable only when the matched quantity is 0 or lower', () => {
    expect(
      evaluateBackInStockOffer({
        product: { items: [item('27', 0)] },
        selectedSkuId: '27',
      }).isUnavailable,
    ).toBe(true);

    expect(
      evaluateBackInStockOffer({
        product: { items: [item('27', -1)] },
        selectedSkuId: '27',
      }).isUnavailable,
    ).toBe(true);

    expect(
      evaluateBackInStockOffer({
        product: { items: [item('27', 3)] },
        selectedSkuId: '27',
      }).isUnavailable,
    ).toBe(false);
  });

  it('treats unknown quantity, an unmatched SKU, and a bad product as available', () => {
    const cases = [
      { product: { items: [item('27', null)] }, selectedSkuId: '27' },
      { product: { items: [item('27', 0)] }, selectedSkuId: '99' },
      {
        product: { items: [{ itemId: '27', sellers: [] }] },
        selectedSkuId: '27',
      },
      { product: { items: [{ itemId: '27' }] }, selectedSkuId: '27' },
      { product: null, selectedSkuId: '27' },
      { product: {}, selectedSkuId: '27' },
      { product: { items: 'nope' }, selectedSkuId: '27' },
    ];

    cases.forEach((input) => {
      expect(evaluateBackInStockOffer(input).isUnavailable).toBe(false);
    });
  });

  it('matches numeric SKUs after stripping leading zeros and leaves alphanumeric SKUs', () => {
    const numeric = evaluateBackInStockOffer({
      product: { items: [item('000326125867', 0)] },
      selectedSkuId: '326125867',
    });
    expect(numeric).toMatchObject({
      isUnavailable: true,
      skuId: '326125867',
    });

    const alpha = evaluateBackInStockOffer({
      product: { items: [item('SKU-01', 0)] },
      selectedSkuId: '0SKU-01',
    });
    expect(alpha.isUnavailable).toBe(false);
    expect(alpha.skuId).toBe('0SKU-01');
  });

  it('picks sellerDefault, then the first seller, then 1', () => {
    expect(
      evaluateBackInStockOffer({
        product: {
          items: [
            item('27', 0, [
              { sellerId: '2', commertialOffer: { AvailableQuantity: 0 } },
              {
                sellerId: '9',
                sellerDefault: true,
                commertialOffer: { AvailableQuantity: 0 },
              },
            ]),
          ],
        },
        selectedSkuId: '27',
      }).seller,
    ).toBe('9');

    expect(
      evaluateBackInStockOffer({
        product: {
          items: [
            item('27', 0, [
              { sellerId: '4', commertialOffer: { AvailableQuantity: 0 } },
            ]),
          ],
        },
        selectedSkuId: '27',
      }).seller,
    ).toBe('4');

    expect(
      evaluateBackInStockOffer({
        product: { items: [item('27', 0, [{ sellerId: '' }])] },
        selectedSkuId: '27',
      }).seller,
    ).toBe('1');
  });

  it('returns an empty sku when none was selected', () => {
    expect(evaluateBackInStockOffer({ product: { items: [] } })).toEqual({
      isUnavailable: false,
      skuId: '',
      seller: '1',
    });
  });
});
