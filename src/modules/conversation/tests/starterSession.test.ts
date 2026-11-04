import StarterSession from '../StarterSession';
import type { StorefrontSnapshot } from '../../storefront/types';
import { EMPTY_SNAPSHOT } from '../../storefront/types';

function snapshot(overrides: Partial<StorefrontSnapshot>): StorefrontSnapshot {
  return { ...EMPTY_SNAPSHOT, ...overrides };
}

describe('starter session', () => {
  const host = {
    getStarters: jest.fn(),
    clearStarters: jest.fn(),
    emit: jest.fn(),
    isConnected: jest.fn(() => true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    host.isConnected.mockReturnValue(true);
  });

  test('requests starters once per fingerprint and clears when leaving the page', () => {
    const session = new StarterSession(host);
    const page = snapshot({
      account: 'acct',
      productPath: '/shoes/p',
      isProductPage: true,
    });

    session.onSnapshot(page);
    session.onSnapshot(page);

    expect(host.getStarters).toHaveBeenCalledTimes(1);
    expect(host.getStarters).toHaveBeenCalledWith({
      account: 'acct',
      linkText: 'shoes',
      productPath: '/shoes/p',
    });

    session.onSnapshot(snapshot({ isProductPage: false }));
    expect(host.clearStarters).toHaveBeenCalledTimes(1);
  });

  test('checkout emits once and does not request starters', () => {
    const session = new StarterSession(host);
    const checkout = snapshot({ isCheckout: true, isProductPage: false });

    session.onSnapshot(checkout);
    session.onSnapshot(checkout);

    expect(host.emit).toHaveBeenCalledTimes(1);
    expect(host.emit).toHaveBeenCalledWith(
      'storefront:entered-checkout',
      expect.objectContaining({ at: expect.any(Number) }),
    );
    expect(host.getStarters).not.toHaveBeenCalled();
  });
});
