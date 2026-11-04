import VtexPageReader from '../VtexPageReader';

describe('product resolution', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as { __RUNTIME__?: unknown }).__RUNTIME__;
    window.history.pushState({}, '', '/');
  });

  test('empty account is missing and skuId is null off a product page', () => {
    (window as { __RUNTIME__?: { account: string } }).__RUNTIME__ = {
      account: '   ',
    };
    window.history.pushState({}, '', '/checkout/');

    const snapshot = new VtexPageReader().read();

    expect(snapshot.account).toBeNull();
    expect(snapshot.skuId).toBeNull();
    expect(snapshot.isCheckout).toBe(true);
    expect(snapshot.isProductPage).toBe(false);
  });

  test('reads account, path, sku, and seller from the product page', () => {
    (window as { __RUNTIME__?: { account: string } }).__RUNTIME__ = {
      account: 'acct',
    };
    window.history.pushState({}, '', '/shoes/p?skuId=42');
    document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify(
      {
        '@type': 'Product',
        sku: '42',
        offers: {
          availability: 'https://schema.org/InStock',
          seller: { identifier: 'seller-1' },
        },
      },
    )}</script>`;

    const snapshot = new VtexPageReader().read();

    expect(snapshot).toMatchObject({
      account: 'acct',
      productPath: '/shoes/p',
      skuId: '42',
      sellerId: 'seller-1',
      available: true,
      isProductPage: true,
      isCheckout: false,
    });
  });
});
