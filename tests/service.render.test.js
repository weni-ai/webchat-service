import WeniWebchatService from '../src/index';
import { installBrowserMocks, makeConfig } from './_helpers/serviceMocks';

const RENDER_KEY = 'weni:webchat:session:12345:render';

describe('WeniWebchatService — render gating', () => {
  let service;
  let getItemSpy;
  let setItemSpy;
  let removeItemSpy;
  let originalWindowLocalStorage;

  beforeEach(() => {
    installBrowserMocks();
    // `_ensureRenderDecision` reads `window.localStorage` directly. In
    // jest-environment-jsdom, `window.localStorage` is a WebIDL-bound
    // `Storage` instance whose methods can't be re-bound via `jest.spyOn`.
    // Replace it with a plain mock for the duration of the test, then
    // restore afterwards.
    originalWindowLocalStorage = window.localStorage;
    getItemSpy = jest.fn().mockReturnValue(null);
    setItemSpy = jest.fn();
    removeItemSpy = jest.fn();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: getItemSpy,
        setItem: setItemSpy,
        removeItem: removeItemSpy,
        clear: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (service) {
      service.destroy();
      service = null;
    }
    jest.restoreAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: originalWindowLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // _ensureRenderDecision()
  // ---------------------------------------------------------------------------
  describe('_ensureRenderDecision()', () => {
    it('returns true and clears stored render key when renderPercentage = 100 (default)', () => {
      service = new WeniWebchatService(makeConfig({ renderPercentage: 100 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(removeItemSpy).toHaveBeenCalledWith(RENDER_KEY);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('returns false and clears stored render key when renderPercentage = 0', () => {
      service = new WeniWebchatService(makeConfig({ renderPercentage: 0 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(false);
      expect(removeItemSpy).toHaveBeenCalledWith(RENDER_KEY);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('reuses stored decision when stored percentage matches (true)', () => {
      getItemSpy.mockReturnValueOnce('50:true');
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('reuses stored decision when stored percentage matches (false)', () => {
      getItemSpy.mockReturnValueOnce('50:false');
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(false);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('recalculates and overwrites when the stored percentage differs', () => {
      getItemSpy.mockReturnValueOnce('25:true');
      jest.spyOn(Math, 'random').mockReturnValue(0.49);
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(setItemSpy).toHaveBeenCalledWith(RENDER_KEY, '50:true');
    });

    it('randomizes a new decision (true) when nothing is stored and Math.random < percentage', () => {
      getItemSpy.mockReturnValueOnce(null);
      jest.spyOn(Math, 'random').mockReturnValue(0.49);
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(setItemSpy).toHaveBeenCalledWith(RENDER_KEY, '50:true');
    });

    it('randomizes a new decision (false) when nothing is stored and Math.random >= percentage', () => {
      getItemSpy.mockReturnValueOnce(null);
      jest.spyOn(Math, 'random').mockReturnValue(0.51);
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(false);
      expect(setItemSpy).toHaveBeenCalledWith(RENDER_KEY, '50:false');
    });

    it('ignores garbage stored values that do not contain a colon', () => {
      getItemSpy.mockReturnValueOnce('garbage');
      jest.spyOn(Math, 'random').mockReturnValue(0.49);
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(setItemSpy).toHaveBeenCalledWith(RENDER_KEY, '50:true');
    });

    it('clamps renderPercentage below 0 to 0 (returns false)', () => {
      service = new WeniWebchatService(makeConfig({ renderPercentage: -10 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(false);
      expect(removeItemSpy).toHaveBeenCalledWith(RENDER_KEY);
    });

    it('clamps renderPercentage above 100 to 100 (returns true)', () => {
      service = new WeniWebchatService(makeConfig({ renderPercentage: 150 }));

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
      expect(removeItemSpy).toHaveBeenCalledWith(RENDER_KEY);
    });

    it('treats non-number renderPercentage as 100 (returns true)', () => {
      // The constructor coerces falsy renderPercentage to DEFAULTS.RENDER_PERCENTAGE
      // (100). We force a non-number after construction to exercise the
      // non-number branch in _ensureRenderDecision.
      service = new WeniWebchatService(makeConfig());
      service.config.renderPercentage = 'all';

      const result = service._ensureRenderDecision();

      expect(result).toBe(true);
    });

    it('uses the channelUuid in the storage key', () => {
      service = new WeniWebchatService(
        makeConfig({ channelUuid: 'abc-xyz', renderPercentage: 100 }),
      );

      service._ensureRenderDecision();

      expect(removeItemSpy).toHaveBeenCalledWith(
        'weni:webchat:session:abc-xyz:render',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // init() short-circuit when render decision is false
  // ---------------------------------------------------------------------------
  describe('init() render gating', () => {
    it('returns { shouldRender: false }, sets _renderEnabled=false, and skips bootstrap', async () => {
      getItemSpy.mockReturnValueOnce('50:false');
      service = new WeniWebchatService(makeConfig({ renderPercentage: 50 }));
      const restoreSpy = jest.spyOn(service, 'restoreOrCreateSession');
      const connectSpy = jest.spyOn(service, 'connect');

      const result = await service.init();

      expect(result).toEqual({ shouldRender: false });
      expect(service._renderEnabled).toBe(false);
      expect(service.isRenderEnabled()).toBe(false);
      expect(restoreSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('continues into bootstrap when render decision is true (renderPercentage=100)', async () => {
      service = new WeniWebchatService(makeConfig({ renderPercentage: 100 }));
      jest.spyOn(service, 'restoreOrCreateSession').mockResolvedValue();
      jest.spyOn(service, 'connect').mockResolvedValue();
      jest.spyOn(service.state, 'getMessages').mockReturnValue([]);

      const result = await service.init();

      expect(result).toEqual({ shouldRender: true });
      expect(service.isRenderEnabled()).toBe(true);
      expect(service._initialized).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isRenderEnabled()
  // ---------------------------------------------------------------------------
  describe('isRenderEnabled()', () => {
    it('returns true by default before init() runs', () => {
      service = new WeniWebchatService(makeConfig());

      expect(service.isRenderEnabled()).toBe(true);
    });

    it('returns false after _renderEnabled is flipped to false', () => {
      service = new WeniWebchatService(makeConfig());
      service._renderEnabled = false;

      expect(service.isRenderEnabled()).toBe(false);
    });

    it('coerces non-boolean values via Boolean()', () => {
      service = new WeniWebchatService(makeConfig());
      service._renderEnabled = 0;
      expect(service.isRenderEnabled()).toBe(false);

      service._renderEnabled = 'truthy';
      expect(service.isRenderEnabled()).toBe(true);
    });
  });
});
