import WeniWebchatService from '../src/index';
import { SERVICE_EVENTS } from '../src/utils/constants';
import { validateStartersData } from '../src/utils/validators';
import { buildStartersRequest } from '../src/utils/messageBuilder';

const VALID_PRODUCT_DATA = {
  account: 'brandless',
  linkText: 'ipad-10th-gen',
};

const FULL_PRODUCT_DATA = {
  account: 'brandless',
  linkText: 'ipad-10th-gen',
  productName: 'iPad 10th Gen',
  description: 'Versatile tablet with Retina display',
  brand: 'Apple',
  attributes: { Storage: '64GB, 256GB', Color: 'Blue, Silver, Pink' },
};

function createService() {
  return new WeniWebchatService({
    socketUrl: 'wss://test.example.com',
    channelUuid: '12345',
  });
}

function makeConnected(service) {
  service._connected = true;
  service.websocket.status = 'connected';
  service.websocket.socket = {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

describe('validateStartersData', () => {
  it('should throw if productData is falsy', () => {
    expect(() => validateStartersData(null)).toThrow(
      'Product data is required',
    );
    expect(() => validateStartersData(undefined)).toThrow(
      'Product data is required',
    );
  });

  it('should throw if account is missing or empty', () => {
    expect(() => validateStartersData({ linkText: 'slug' })).toThrow(
      'account is required and must be a non-empty string',
    );
    expect(() =>
      validateStartersData({ account: '', linkText: 'slug' }),
    ).toThrow('account is required and must be a non-empty string');
    expect(() =>
      validateStartersData({ account: 123, linkText: 'slug' }),
    ).toThrow('account is required and must be a non-empty string');
  });

  it('should throw if linkText is missing or empty', () => {
    expect(() => validateStartersData({ account: 'store' })).toThrow(
      'linkText is required and must be a non-empty string',
    );
    expect(() =>
      validateStartersData({ account: 'store', linkText: '' }),
    ).toThrow('linkText is required and must be a non-empty string');
  });

  it('should not throw with valid data', () => {
    expect(() => validateStartersData(VALID_PRODUCT_DATA)).not.toThrow();
    expect(() => validateStartersData(FULL_PRODUCT_DATA)).not.toThrow();
  });
});

describe('buildStartersRequest', () => {
  it('should build correct payload with required fields only', () => {
    const payload = buildStartersRequest('session-123', VALID_PRODUCT_DATA);

    expect(payload).toEqual({
      type: 'get_pdp_starters',
      from: 'session-123',
      data: {
        account: 'brandless',
        linkText: 'ipad-10th-gen',
      },
    });
  });

  it('should include optional fields when provided', () => {
    const payload = buildStartersRequest('session-123', FULL_PRODUCT_DATA);

    expect(payload).toEqual({
      type: 'get_pdp_starters',
      from: 'session-123',
      data: {
        account: 'brandless',
        linkText: 'ipad-10th-gen',
        productName: 'iPad 10th Gen',
        description: 'Versatile tablet with Retina display',
        brand: 'Apple',
        attributes: { Storage: '64GB, 256GB', Color: 'Blue, Silver, Pink' },
      },
    });
  });

  it('should omit optional fields when not provided', () => {
    const payload = buildStartersRequest('session-123', VALID_PRODUCT_DATA);

    expect(payload.data).not.toHaveProperty('productName');
    expect(payload.data).not.toHaveProperty('description');
    expect(payload.data).not.toHaveProperty('brand');
    expect(payload.data).not.toHaveProperty('attributes');
  });
});

describe('WeniWebchatService - getStarters', () => {
  let service;

  beforeEach(() => {
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
    global.WebSocket = jest.fn().mockImplementation(() => ({
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      readyState: 1,
    }));
    global.WebSocket.OPEN = 1;

    service = createService();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
  });

  describe('sending requests', () => {
    it('should send get_pdp_starters message with correct payload', () => {
      makeConnected(service);
      const sendSpy = jest.spyOn(service.websocket, 'send');

      service.getStarters(VALID_PRODUCT_DATA);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'get_pdp_starters',
          data: expect.objectContaining({
            account: 'brandless',
            linkText: 'ipad-10th-gen',
          }),
        }),
      );
    });

    it('should throw if productData is invalid', () => {
      makeConnected(service);

      expect(() => service.getStarters(null)).toThrow(
        'Product data is required',
      );
      expect(() => service.getStarters({ linkText: 'slug' })).toThrow(
        'account is required',
      );
    });
  });

  describe('connection guards (US2)', () => {
    it('should throw when not connected', () => {
      expect(() => service.getStarters(VALID_PRODUCT_DATA)).toThrow(
        'WebSocket not connected',
      );
    });

    it('should throw when in connecting state', () => {
      service._connecting = true;
      service.websocket.status = 'connecting';

      expect(() => service.getStarters(VALID_PRODUCT_DATA)).toThrow(
        'WebSocket not connected',
      );
    });

    it('should throw after disconnect', () => {
      makeConnected(service);
      service._connected = false;
      service.websocket.status = 'disconnected';

      expect(() => service.getStarters(VALID_PRODUCT_DATA)).toThrow(
        'WebSocket not connected',
      );
    });
  });

  describe('receiving starters:received event (US1)', () => {
    it('should emit starters:received when server responds with starters', () => {
      makeConnected(service);
      const handler = jest.fn();
      service.on(SERVICE_EVENTS.STARTERS_RECEIVED, handler);

      service.getStarters(VALID_PRODUCT_DATA);

      service.websocket.emit(SERVICE_EVENTS.STARTERS_RECEIVED, {
        questions: ['Q1?', 'Q2?', 'Q3?'],
      });

      expect(handler).toHaveBeenCalledWith({
        questions: ['Q1?', 'Q2?', 'Q3?'],
      });
    });
  });

  describe('receiving starters:error event (US1)', () => {
    it('should emit starters:error when server responds with starters-related error', () => {
      makeConnected(service);
      const handler = jest.fn();
      service.on(SERVICE_EVENTS.STARTERS_ERROR, handler);

      service.getStarters(VALID_PRODUCT_DATA);

      service.websocket.emit(SERVICE_EVENTS.STARTERS_ERROR, {
        error: 'failed to generate conversation starters: timeout',
      });

      expect(handler).toHaveBeenCalledWith({
        error: 'failed to generate conversation starters: timeout',
      });
    });

    it('should not emit starters:error for non-starters errors', () => {
      makeConnected(service);
      const startersHandler = jest.fn();
      service.on(SERVICE_EVENTS.STARTERS_ERROR, startersHandler);

      service.getStarters(VALID_PRODUCT_DATA);

      service.websocket.emit(SERVICE_EVENTS.ERROR, new Error('network error'));

      expect(startersHandler).not.toHaveBeenCalled();
    });
  });

  describe('fingerprinting and stale responses (US3)', () => {
    it('should not emit starters:received after clearStarters()', () => {
      makeConnected(service);
      const handler = jest.fn();
      service.on(SERVICE_EVENTS.STARTERS_RECEIVED, handler);

      service.getStarters(VALID_PRODUCT_DATA);
      service.clearStarters();

      service.websocket.emit(SERVICE_EVENTS.STARTERS_RECEIVED, {
        questions: ['Q1?'],
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should update fingerprint on successive getStarters calls', () => {
      makeConnected(service);

      service.getStarters({ account: 'a', linkText: 'product-a' });
      expect(service._latestStartersFingerprint).toBe('a:product-a');

      service.getStarters({ account: 'b', linkText: 'product-b' });
      expect(service._latestStartersFingerprint).toBe('b:product-b');
    });

    it('should clear fingerprint after emitting starters:received', () => {
      makeConnected(service);
      service.on(SERVICE_EVENTS.STARTERS_RECEIVED, () => {});

      service.getStarters(VALID_PRODUCT_DATA);
      expect(service._latestStartersFingerprint).not.toBeNull();

      service.websocket.emit(SERVICE_EVENTS.STARTERS_RECEIVED, {
        questions: ['Q1?'],
      });

      expect(service._latestStartersFingerprint).toBeNull();
    });

    it('should clear fingerprint after emitting starters:error', () => {
      makeConnected(service);
      service.on(SERVICE_EVENTS.STARTERS_ERROR, () => {});

      service.getStarters(VALID_PRODUCT_DATA);
      expect(service._latestStartersFingerprint).not.toBeNull();

      service.websocket.emit(SERVICE_EVENTS.STARTERS_ERROR, {
        error: 'starters error',
      });

      expect(service._latestStartersFingerprint).toBeNull();
    });

    it('should not emit stale starters:error after clearStarters()', () => {
      makeConnected(service);
      const handler = jest.fn();
      service.on(SERVICE_EVENTS.STARTERS_ERROR, handler);

      service.getStarters(VALID_PRODUCT_DATA);
      service.clearStarters();

      service.websocket.emit(SERVICE_EVENTS.STARTERS_ERROR, {
        error: 'starters error',
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('WebSocketManager - starters message handling', () => {
  let service;

  beforeEach(() => {
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
    global.WebSocket = jest.fn().mockImplementation(() => ({
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      readyState: 1,
    }));
    global.WebSocket.OPEN = 1;

    service = createService();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
  });

  it('should emit STARTERS_RECEIVED on incoming starters message', () => {
    const handler = jest.fn();
    service.websocket.on(SERVICE_EVENTS.STARTERS_RECEIVED, handler);

    service.websocket._handleMessage({
      data: JSON.stringify({
        type: 'starters',
        data: { questions: ['Q1?', 'Q2?'] },
      }),
    });

    expect(handler).toHaveBeenCalledWith({ questions: ['Q1?', 'Q2?'] });
  });

  it('should emit STARTERS_ERROR on incoming starters-related error', () => {
    const handler = jest.fn();
    service.websocket.on(SERVICE_EVENTS.STARTERS_ERROR, handler);

    service.websocket._handleMessage({
      data: JSON.stringify({
        type: 'error',
        error: 'failed to generate conversation starters: Lambda timeout',
      }),
    });

    expect(handler).toHaveBeenCalledWith({
      error: 'failed to generate conversation starters: Lambda timeout',
    });
  });

  it('should emit STARTERS_ERROR on concurrency limit error', () => {
    const handler = jest.fn();
    service.websocket.on(SERVICE_EVENTS.STARTERS_ERROR, handler);

    service.websocket._handleMessage({
      data: JSON.stringify({
        type: 'error',
        error: 'get pdp starters: concurrency limit reached, try again later',
      }),
    });

    expect(handler).toHaveBeenCalledWith({
      error: 'get pdp starters: concurrency limit reached, try again later',
    });
  });

  it('should NOT emit STARTERS_ERROR for non-starters errors', () => {
    const startersHandler = jest.fn();
    const errorHandler = jest.fn();
    service.websocket.on(SERVICE_EVENTS.STARTERS_ERROR, startersHandler);
    service.websocket.on(SERVICE_EVENTS.ERROR, errorHandler);

    service.websocket._handleMessage({
      data: JSON.stringify({
        type: 'error',
        error: 'unable to register: invalid token',
      }),
    });

    expect(startersHandler).not.toHaveBeenCalled();
    expect(errorHandler).toHaveBeenCalled();
  });

  it('should not pass starters messages to the generic MESSAGE handler', () => {
    const messageHandler = jest.fn();
    service.websocket.on(SERVICE_EVENTS.MESSAGE, messageHandler);

    service.websocket._handleMessage({
      data: JSON.stringify({
        type: 'starters',
        data: { questions: ['Q1?'] },
      }),
    });

    expect(messageHandler).not.toHaveBeenCalled();
  });
});
