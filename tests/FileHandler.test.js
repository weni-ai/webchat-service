import FileHandler from '../src/modules/FileHandler';
import {
  ALLOWED_FILE_TYPES,
  DEFAULTS,
  SERVICE_EVENTS,
} from '../src/utils/constants';

// ---------------------------------------------------------------------------
// Browser API mock helpers
//
// FileHandler talks to three browser APIs:
//   - File / FileReader (used inside _toBase64)
//   - Image (used inside _compressImage)
//   - document.createElement('canvas') + canvas.getContext('2d') (compression)
//
// jsdom provides File and FileReader, so the happy path goes through those
// directly. Image and Canvas need stubbing because jsdom never fires onload
// for new Image() and canvas.getContext('2d') returns null in jsdom.
// ---------------------------------------------------------------------------

/**
 * Builds a real jsdom File for the given metadata. When `size` is supplied
 * AND exceeds the actual byte length (e.g. simulating a 33 MB upload),
 * Object.defineProperty overrides the read-only `size` getter so the test
 * can drive the boundary without allocating a big buffer.
 */
function makeFile({
  name = 'test.png',
  type = 'image/png',
  size,
  content = ['x'],
} = {}) {
  const file = new File(content, name, { type });
  if (typeof size === 'number') {
    Object.defineProperty(file, 'size', {
      value: size,
      configurable: true,
    });
  }
  return file;
}

/**
 * Replaces global.Image with a jest-friendly fake whose `src` setter
 * schedules `onload` (or `onerror` when `mode === 'error'`) on a microtask.
 * The configured width/height become the loaded image's natural dimensions,
 * which _compressImage reads to compute the resize ratio.
 *
 * Returns a `ref` whose `.last` slot holds the most recently constructed
 * mock so tests can introspect what FileHandler did with it.
 */
function installImageMock({ width = 100, height = 100, mode = 'load' } = {}) {
  const ref = { last: null };

  class MockImage {
    constructor() {
      this.width = width;
      this.height = height;
      this.onload = null;
      this.onerror = null;
      ref.last = this;
    }
    set src(value) {
      this._src = value;
      // Microtask scheduling matches the await chain inside _compressImage
      // and avoids racing the onload/onerror assignment in the caller.
      queueMicrotask(() => {
        if (mode === 'error') {
          if (this.onerror) this.onerror();
        } else if (this.onload) {
          this.onload();
        }
      });
    }
    get src() {
      return this._src;
    }
  }

  global.Image = MockImage;
  return ref;
}

/**
 * Spies on document.createElement so only `'canvas'` is intercepted. Other
 * tags (used by jsdom internals) fall through to the real implementation.
 *
 * The fake canvas exposes spied `getContext` (returning a `drawImage` spy)
 * and `toDataURL`. Pass `getContextThrows` to drive the catch branch in
 * _compressImage.
 */
function installCanvasMock({
  toDataURLValue = 'data:image/png;base64,COMPRESSED',
  getContextThrows = null,
} = {}) {
  // Capture BEFORE jest.spyOn replaces document.createElement, otherwise
  // the fall-through path would recursively call the spy.
  const realCreateElement = document.createElement.bind(document);

  const ref = {
    lastCanvas: null,
    getContextSpy: null,
    drawImageSpy: null,
    toDataURLSpy: null,
  };

  ref.spy = jest.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') {
      return realCreateElement(tag);
    }

    const drawImage = jest.fn();
    const toDataURL = jest.fn(() => toDataURLValue);
    const getContext = jest.fn(() => {
      if (getContextThrows) {
        throw getContextThrows;
      }
      return { drawImage };
    });

    const canvas = {
      width: 0,
      height: 0,
      getContext,
      toDataURL,
    };

    ref.lastCanvas = canvas;
    ref.getContextSpy = getContext;
    ref.drawImageSpy = drawImage;
    ref.toDataURLSpy = toDataURL;

    return canvas;
  });

  return ref;
}

/**
 * Synchronous FileReader stub that fires `onerror` immediately. Mirrors the
 * pattern at the bottom of tests/AudioRecorder.test.js (`_blobToBase64`
 * error test).
 */
class FailingFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  readAsDataURL() {
    if (this.onerror) this.onerror(new Error('synthetic'));
  }
}

/**
 * Returns a fresh FileHandler with optional config overrides.
 */
function createHandler(overrides = {}) {
  return new FileHandler(overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileHandler', () => {
  let originalImage;
  let originalFileReader;

  beforeAll(() => {
    originalImage = global.Image;
    originalFileReader = global.FileReader;
  });

  afterAll(() => {
    if (originalImage) {
      global.Image = originalImage;
    } else {
      delete global.Image;
    }
    if (originalFileReader) {
      global.FileReader = originalFileReader;
    } else {
      delete global.FileReader;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalImage) {
      global.Image = originalImage;
    }
    if (originalFileReader) {
      global.FileReader = originalFileReader;
    }
  });

  // -------------------------------------------------------------------------
  // A. Constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('extends EventEmitter so consumers can on()/emit() against it', () => {
      const handler = createHandler();
      const listener = jest.fn();

      handler.on('custom:event', listener);
      handler.emit('custom:event', 'payload');

      expect(listener).toHaveBeenCalledWith('payload');
    });

    it('applies documented defaults from DEFAULTS / ALLOWED_FILE_TYPES when given no config', () => {
      const handler = createHandler();

      expect(handler.config.maxFileSize).toBe(DEFAULTS.MAX_FILE_SIZE);
      expect(handler.config.allowedTypes).toEqual(ALLOWED_FILE_TYPES);
      expect(handler.config.compressImages).toBe(true);
      expect(handler.config.imageQuality).toBe(DEFAULTS.IMAGE_QUALITY);
      expect(handler.config.maxImageWidth).toBe(DEFAULTS.MAX_IMAGE_WIDTH);
      expect(handler.config.maxImageHeight).toBe(DEFAULTS.MAX_IMAGE_HEIGHT);
    });

    it('honors caller overrides for every documented option', () => {
      const customAllowed = ['image/png'];
      const handler = createHandler({
        maxFileSize: 1234,
        allowedTypes: customAllowed,
        imageQuality: 0.5,
        maxImageWidth: 800,
        maxImageHeight: 600,
      });

      expect(handler.config.maxFileSize).toBe(1234);
      expect(handler.config.allowedTypes).toBe(customAllowed);
      expect(handler.config.imageQuality).toBe(0.5);
      expect(handler.config.maxImageWidth).toBe(800);
      expect(handler.config.maxImageHeight).toBe(600);
    });

    it('preserves extra config keys via the trailing spread', () => {
      const handler = createHandler({ extra: 'value', context: { a: 1 } });

      expect(handler.config.extra).toBe('value');
      expect(handler.config.context).toEqual({ a: 1 });
    });

    it('accepts being instantiated with no arguments at all', () => {
      const handler = new FileHandler();

      expect(handler.config.maxFileSize).toBe(DEFAULTS.MAX_FILE_SIZE);
      expect(handler.config.allowedTypes).toEqual(ALLOWED_FILE_TYPES);
      expect(handler.config.compressImages).toBe(true);
    });

    // The constructor uses
    //   compressImages: config.compressImages !== false || DEFAULTS.COMPRESS_IMAGES
    // which evaluates to `true` for any input. The trailing `...config`
    // spread (one line later) is what actually lets a caller disable
    // compression by passing `compressImages: false`. These tests pin down
    // the observable behavior so a future refactor can't regress it.
    it('honors compressImages: false via the trailing config spread', () => {
      const handler = createHandler({ compressImages: false });
      expect(handler.config.compressImages).toBe(false);
    });

    it('honors compressImages: true', () => {
      const handler = createHandler({ compressImages: true });
      expect(handler.config.compressImages).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // B. process() — happy paths
  // -------------------------------------------------------------------------
  describe('process() — happy paths', () => {
    it('processes an image: compresses by default, emits FILE_PROCESSED, returns the metadata', async () => {
      installImageMock({ width: 200, height: 200 });
      installCanvasMock({ toDataURLValue: 'data:image/png;base64,SMALL' });

      const handler = createHandler();
      const fileProcessed = jest.fn();
      handler.on(SERVICE_EVENTS.FILE_PROCESSED, fileProcessed);

      const file = makeFile({ name: 'pic.png', type: 'image/png' });
      const result = await handler.process(file);

      expect(result).toEqual({
        type: 'image',
        base64: 'data:image/png;base64,SMALL',
        filename: 'pic.png',
        size: file.size,
        mimeType: 'image/png',
      });
      expect(fileProcessed).toHaveBeenCalledTimes(1);
      expect(fileProcessed).toHaveBeenCalledWith(result);
    });

    it('skips compression when compressImages is false and returns the raw FileReader base64', async () => {
      const canvasMock = installCanvasMock();

      const handler = createHandler({ compressImages: false });
      const file = makeFile({
        name: 'pic.png',
        type: 'image/png',
        content: ['hello'],
      });

      const result = await handler.process(file);

      expect(result.type).toBe('image');
      expect(result.base64.startsWith('data:image/png;base64,')).toBe(true);
      expect(result.base64).not.toBe('data:image/png;base64,COMPRESSED');
      expect(canvasMock.spy).not.toHaveBeenCalledWith('canvas');
    });

    it('processes a video: type=video, no compression', async () => {
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      const file = makeFile({
        name: 'movie.mp4',
        type: 'video/mp4',
        content: ['vid'],
      });
      const result = await handler.process(file);

      expect(result.type).toBe('video');
      expect(result.filename).toBe('movie.mp4');
      expect(result.mimeType).toBe('video/mp4');
      expect(result.base64.startsWith('data:video/mp4;base64,')).toBe(true);
      expect(canvasMock.spy).not.toHaveBeenCalledWith('canvas');
    });

    it('processes audio: type=audio, no compression', async () => {
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      const file = makeFile({
        name: 'song.mp3',
        type: 'audio/mpeg',
        content: ['aud'],
      });
      const result = await handler.process(file);

      expect(result.type).toBe('audio');
      expect(result.base64.startsWith('data:audio/mpeg;base64,')).toBe(true);
      expect(canvasMock.spy).not.toHaveBeenCalledWith('canvas');
    });

    it('processes a document: type=file, no compression', async () => {
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      const file = makeFile({
        name: 'doc.pdf',
        type: 'application/pdf',
        content: ['pdf'],
      });
      const result = await handler.process(file);

      expect(result.type).toBe('file');
      expect(result.filename).toBe('doc.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(canvasMock.spy).not.toHaveBeenCalledWith('canvas');
    });
  });

  // -------------------------------------------------------------------------
  // C. process() — error paths
  // -------------------------------------------------------------------------
  describe('process() — error paths', () => {
    it('emits ERROR and rethrows when validation fails', async () => {
      const handler = createHandler();
      const onError = jest.fn();
      handler.on(SERVICE_EVENTS.ERROR, onError);

      await expect(handler.process(undefined)).rejects.toThrow(
        'No file provided',
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No file provided' }),
      );
    });

    it('emits ERROR and rethrows when FileReader fires onerror', async () => {
      global.FileReader = FailingFileReader;

      const handler = createHandler();
      const onError = jest.fn();
      handler.on(SERVICE_EVENTS.ERROR, onError);

      const file = makeFile({ name: 'doc.pdf', type: 'application/pdf' });
      await expect(handler.process(file)).rejects.toThrow(
        'Failed to read file',
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Failed to read file' }),
      );
    });

    it('emits ERROR and rethrows when Image.onerror fires during compression', async () => {
      installImageMock({ mode: 'error' });
      installCanvasMock();

      const handler = createHandler();
      const onError = jest.fn();
      handler.on(SERVICE_EVENTS.ERROR, onError);

      const file = makeFile({ name: 'pic.png', type: 'image/png' });
      await expect(handler.process(file)).rejects.toThrow(
        'Failed to load image for compression',
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to load image for compression',
        }),
      );
    });

    it('emits ERROR and rethrows when canvas.getContext throws', async () => {
      const ctxError = new Error('canvas exploded');
      installImageMock({ width: 100, height: 100 });
      installCanvasMock({ getContextThrows: ctxError });

      const handler = createHandler();
      const onError = jest.fn();
      handler.on(SERVICE_EVENTS.ERROR, onError);

      const file = makeFile({ name: 'pic.png', type: 'image/png' });

      await expect(handler.process(file)).rejects.toBe(ctxError);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(ctxError);
    });
  });

  // -------------------------------------------------------------------------
  // D. processMultiple()
  // -------------------------------------------------------------------------
  describe('processMultiple()', () => {
    it('returns [] for an empty array and emits nothing', async () => {
      const handler = createHandler();
      const fileProcessed = jest.fn();
      handler.on(SERVICE_EVENTS.FILE_PROCESSED, fileProcessed);

      const result = await handler.processMultiple([]);

      expect(result).toEqual([]);
      expect(fileProcessed).not.toHaveBeenCalled();
    });

    it('processes 3 mixed files in parallel and emits FILE_PROCESSED for each', async () => {
      const handler = createHandler();
      const fileProcessed = jest.fn();
      handler.on(SERVICE_EVENTS.FILE_PROCESSED, fileProcessed);

      const files = [
        makeFile({ name: 'a.mp4', type: 'video/mp4' }),
        makeFile({ name: 'b.mp3', type: 'audio/mpeg' }),
        makeFile({ name: 'c.pdf', type: 'application/pdf' }),
      ];

      const results = await handler.processMultiple(files);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.type)).toEqual(['video', 'audio', 'file']);
      expect(results.map((r) => r.filename)).toEqual([
        'a.mp4',
        'b.mp3',
        'c.pdf',
      ]);
      expect(fileProcessed).toHaveBeenCalledTimes(3);
    });

    it('accepts a FileList-like array-like via Array.from', async () => {
      const handler = createHandler();
      const f1 = makeFile({ name: 'x.pdf', type: 'application/pdf' });
      const f2 = makeFile({ name: 'y.pdf', type: 'application/pdf' });
      const fileListLike = { 0: f1, 1: f2, length: 2 };

      const results = await handler.processMultiple(fileListLike);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe('x.pdf');
      expect(results[1].filename).toBe('y.pdf');
    });

    it('rejects the whole batch when any single file fails validation', async () => {
      const handler = createHandler();
      const onError = jest.fn();
      handler.on(SERVICE_EVENTS.ERROR, onError);

      const good = makeFile({ name: 'good.pdf', type: 'application/pdf' });
      const bad = makeFile({ name: 'bad.zip', type: 'application/zip' });

      await expect(handler.processMultiple([good, bad])).rejects.toThrow(
        'File type application/zip is not allowed',
      );

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'File type application/zip is not allowed',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // E. _validateFile (driven through process())
  // -------------------------------------------------------------------------
  describe('_validateFile (driven through process())', () => {
    it('rejects when file is undefined', async () => {
      const handler = createHandler();
      await expect(handler.process(undefined)).rejects.toThrow(
        'No file provided',
      );
    });

    it('rejects when file is null', async () => {
      const handler = createHandler();
      await expect(handler.process(null)).rejects.toThrow('No file provided');
    });

    it('rejects a file with an empty type', async () => {
      const handler = createHandler();
      const file = makeFile({ type: '' });
      await expect(handler.process(file)).rejects.toThrow(
        'File type is required',
      );
    });

    it('rejects a disallowed type with the type echoed in the message', async () => {
      const handler = createHandler();
      const file = makeFile({ type: 'application/zip' });
      await expect(handler.process(file)).rejects.toThrow(
        'File type application/zip is not allowed',
      );
    });

    it('passes when size === maxFileSize (boundary, not strictly greater)', async () => {
      const handler = createHandler({ maxFileSize: 100 });
      const file = makeFile({ type: 'application/pdf', size: 100 });
      await expect(handler.process(file)).resolves.toMatchObject({
        type: 'file',
      });
    });

    it('rejects when size === maxFileSize + 1 with the rounded-MB suffix', async () => {
      const handler = createHandler();
      const file = makeFile({
        type: 'application/pdf',
        size: DEFAULTS.MAX_FILE_SIZE + 1,
      });
      await expect(handler.process(file)).rejects.toThrow(
        'File size exceeds 32MB limit',
      );
    });

    it('honors a custom allowedTypes config', async () => {
      const handler = createHandler({ allowedTypes: ['image/png'] });
      const file = makeFile({ name: 'pic.jpg', type: 'image/jpeg' });
      await expect(handler.process(file)).rejects.toThrow(
        'File type image/jpeg is not allowed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // F. _getFileType (driven through process())
  // -------------------------------------------------------------------------
  describe('_getFileType (driven through process())', () => {
    it('maps every image/* MIME in ALLOWED_FILE_TYPES to "image"', async () => {
      installImageMock();
      installCanvasMock();
      const handler = createHandler();

      for (const type of ['image/png', 'image/jpeg', 'image/svg+xml']) {
        const result = await handler.process(makeFile({ type }));
        expect(result.type).toBe('image');
      }
    });

    it('maps every video/* MIME in ALLOWED_FILE_TYPES to "video"', async () => {
      const handler = createHandler();

      for (const type of ['video/mp4', 'video/quicktime']) {
        const result = await handler.process(makeFile({ type }));
        expect(result.type).toBe('video');
      }
    });

    it('maps every audio/* MIME in ALLOWED_FILE_TYPES to "audio"', async () => {
      const handler = createHandler();

      for (const type of ['audio/mpeg', 'audio/wav']) {
        const result = await handler.process(makeFile({ type }));
        expect(result.type).toBe('audio');
      }
    });

    it('falls through to the catch-all "file" branch for any other allowed type', async () => {
      const handler = createHandler({ allowedTypes: ['text/plain'] });
      const file = makeFile({
        type: 'text/plain',
        name: 'note.txt',
        content: ['hi'],
      });
      const result = await handler.process(file);
      expect(result.type).toBe('file');
    });
  });

  // -------------------------------------------------------------------------
  // G. _toBase64
  // -------------------------------------------------------------------------
  describe('_toBase64', () => {
    it('happy path: produces a real data:URL via jsdom FileReader (driven through process)', async () => {
      const handler = createHandler();
      const file = makeFile({
        name: 'song.mp3',
        type: 'audio/mpeg',
        content: ['data'],
      });

      const result = await handler.process(file);
      expect(result.base64.startsWith('data:audio/mpeg;base64,')).toBe(true);
    });

    it('rejects with "Failed to read file" when FileReader fires onerror', async () => {
      global.FileReader = FailingFileReader;

      const handler = createHandler();
      await expect(handler._toBase64({})).rejects.toThrow(
        'Failed to read file',
      );
    });
  });

  // -------------------------------------------------------------------------
  // H. _compressImage
  // -------------------------------------------------------------------------
  describe('_compressImage', () => {
    it('within bounds: canvas matches source; drawImage and toDataURL receive expected args', async () => {
      installImageMock({ width: 100, height: 100 });
      const canvasMock = installCanvasMock({
        toDataURLValue: 'data:image/png;base64,X',
      });
      const handler = createHandler();

      const result = await handler._compressImage(
        'data:image/png;base64,SRC',
        'image/png',
      );

      expect(canvasMock.lastCanvas.width).toBe(100);
      expect(canvasMock.lastCanvas.height).toBe(100);
      expect(canvasMock.drawImageSpy).toHaveBeenCalledWith(
        expect.any(Object),
        0,
        0,
        100,
        100,
      );
      expect(canvasMock.toDataURLSpy).toHaveBeenCalledWith(
        'image/png',
        DEFAULTS.IMAGE_QUALITY,
      );
      expect(result).toBe('data:image/png;base64,X');
    });

    it('wider only: scales by maxImageWidth / width', async () => {
      installImageMock({ width: 4000, height: 500 });
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      await handler._compressImage('data:src', 'image/png');

      const ratio = DEFAULTS.MAX_IMAGE_WIDTH / 4000;
      expect(canvasMock.lastCanvas.width).toBe(4000 * ratio);
      expect(canvasMock.lastCanvas.height).toBe(500 * ratio);
    });

    it('taller only: scales by maxImageHeight / height', async () => {
      installImageMock({ width: 500, height: 4000 });
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      await handler._compressImage('data:src', 'image/png');

      const ratio = DEFAULTS.MAX_IMAGE_HEIGHT / 4000;
      expect(canvasMock.lastCanvas.width).toBe(500 * ratio);
      expect(canvasMock.lastCanvas.height).toBe(4000 * ratio);
    });

    it('both wider and taller: uses min(widthRatio, heightRatio)', async () => {
      installImageMock({ width: 4000, height: 3000 });
      const canvasMock = installCanvasMock();
      const handler = createHandler();

      await handler._compressImage('data:src', 'image/png');

      const ratio = Math.min(
        DEFAULTS.MAX_IMAGE_WIDTH / 4000,
        DEFAULTS.MAX_IMAGE_HEIGHT / 3000,
      );
      expect(canvasMock.lastCanvas.width).toBe(4000 * ratio);
      expect(canvasMock.lastCanvas.height).toBe(3000 * ratio);
    });

    it('forwards custom imageQuality, maxImageWidth, and maxImageHeight to toDataURL / ratio math', async () => {
      installImageMock({ width: 1600, height: 1200 });
      const canvasMock = installCanvasMock();

      const handler = createHandler({
        imageQuality: 0.5,
        maxImageWidth: 800,
        maxImageHeight: 600,
      });

      await handler._compressImage('data:src', 'image/jpeg');

      const ratio = Math.min(800 / 1600, 600 / 1200);
      expect(canvasMock.lastCanvas.width).toBe(1600 * ratio);
      expect(canvasMock.lastCanvas.height).toBe(1200 * ratio);
      expect(canvasMock.toDataURLSpy).toHaveBeenCalledWith('image/jpeg', 0.5);
    });

    it('rejects with "Failed to load image for compression" when Image.onerror fires', async () => {
      installImageMock({ mode: 'error' });
      installCanvasMock();
      const handler = createHandler();

      await expect(
        handler._compressImage('data:src', 'image/png'),
      ).rejects.toThrow('Failed to load image for compression');
    });

    it('rejects with the underlying error when canvas.getContext throws', async () => {
      const ctxError = new Error('ctx exploded');
      installImageMock({ width: 100, height: 100 });
      installCanvasMock({ getContextThrows: ctxError });
      const handler = createHandler();

      await expect(
        handler._compressImage('data:src', 'image/png'),
      ).rejects.toBe(ctxError);
    });
  });
});
