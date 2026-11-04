import StorageManager from '../../../core/StorageManager';

describe('storefront storage key', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('round-trips a storefront record and treats invalid JSON as empty', () => {
    const storage = new StorageManager('local');
    storage.setStorefrontRecord({
      snapshot: { account: 'acct' },
      pendingCart: {},
    });

    expect(storage.getStorefrontRecord().snapshot).toEqual({ account: 'acct' });
    expect(localStorage.getItem('weni:webchat:session')).toBeNull();

    localStorage.setItem('weni:webchat:storefront', '{');
    expect(storage.getStorefrontRecord()).toEqual({
      snapshot: null,
      pendingCart: {},
    });
  });
});
