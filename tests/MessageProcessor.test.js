import MessageProcessor from '../src/core/MessageProcessor';
import {
  SERVICE_EVENTS,
  MESSAGE_ID_PREFIX,
  STREAM_INITIAL_SEQUENCE,
  DEFAULTS,
} from '../src/utils/constants';

describe('MessageProcessor', () => {
  let processor;
  let mockEmit;

  beforeEach(() => {
    jest.useFakeTimers();
    processor = new MessageProcessor({
      messageDelay: 0,
      typingDelay: 100,
      enableTypingIndicator: true,
      typingTimeout: 5000,
    });
    mockEmit = jest.spyOn(processor, 'emit');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      const defaultProcessor = new MessageProcessor();

      expect(defaultProcessor.config.messageDelay).toBe(DEFAULTS.MESSAGE_DELAY);
      expect(defaultProcessor.config.typingDelay).toBe(DEFAULTS.TYPING_DELAY);
      expect(defaultProcessor.config.enableTypingIndicator).toBe(true);
      expect(defaultProcessor.config.typingTimeout).toBe(
        DEFAULTS.TYPING_TIMEOUT,
      );
    });

    it('should initialize with custom config', () => {
      const customProcessor = new MessageProcessor({
        messageDelay: 500,
        typingDelay: 200,
        enableTypingIndicator: false,
        typingTimeout: 10000,
      });

      expect(customProcessor.config.messageDelay).toBe(500);
      expect(customProcessor.config.typingDelay).toBe(200);
      expect(customProcessor.config.typingTimeout).toBe(10000);
    });

    it('should preserve explicit enableTypingIndicator: false', () => {
      const disabledProcessor = new MessageProcessor({
        enableTypingIndicator: false,
      });

      expect(disabledProcessor.config.enableTypingIndicator).toBe(false);
    });

    it('should initialize streaming state', () => {
      expect(processor.activeStreamId).toBeNull();
      expect(processor.pendingDeltas).toBeInstanceOf(Map);
      expect(processor.pendingDeltas.size).toBe(0);
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
      expect(processor.streamMessageEmitted).toBe(false);
    });

    it('should initialize empty queue and streams', () => {
      expect(processor.queue).toEqual([]);
      expect(processor.streams).toBeInstanceOf(Map);
      expect(processor.streams.size).toBe(0);
      expect(processor.isProcessing).toBe(false);
    });
  });

  describe('_resetStreamState', () => {
    it('should reset state to initial values without streamId', () => {
      processor.activeStreamId = 'test-stream';
      processor.pendingDeltas.set(1, 'content');
      processor.nextExpectedSeq = 5;
      processor.streamMessageEmitted = true;

      processor._resetStreamState();

      expect(processor.activeStreamId).toBeNull();
      expect(processor.pendingDeltas.size).toBe(0);
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
      expect(processor.streamMessageEmitted).toBe(false);
    });

    it('should reset state with provided streamId', () => {
      processor._resetStreamState('new-stream-id');

      expect(processor.activeStreamId).toBe('new-stream-id');
      expect(processor.pendingDeltas.size).toBe(0);
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
      expect(processor.streamMessageEmitted).toBe(false);
    });
  });

  describe('_extractMessageType', () => {
    it('should return "unknown" for null or undefined', () => {
      expect(processor._extractMessageType(null)).toBe('unknown');
      expect(processor._extractMessageType(undefined)).toBe('unknown');
    });

    it('should return "unknown" for non-object input', () => {
      expect(processor._extractMessageType('string')).toBe('unknown');
      expect(processor._extractMessageType(123)).toBe('unknown');
    });

    it('should detect delta messages by v and seq properties without type', () => {
      const deltaMessage = { v: 'Hello', seq: 1 };
      expect(processor._extractMessageType(deltaMessage)).toBe('delta');
    });

    it('should not detect as delta if type property exists', () => {
      const messageWithType = { v: 'Hello', seq: 1, type: 'message' };
      expect(processor._extractMessageType(messageWithType)).toBe('message');
    });

    it('should return type from raw.type', () => {
      expect(processor._extractMessageType({ type: 'stream_start' })).toBe(
        'stream_start',
      );
      expect(processor._extractMessageType({ type: 'stream_end' })).toBe(
        'stream_end',
      );
      expect(processor._extractMessageType({ type: 'message' })).toBe(
        'message',
      );
    });

    it('should return type from raw.message.type', () => {
      const raw = { message: { type: 'text' } };
      expect(processor._extractMessageType(raw)).toBe('text');
    });

    it('should return "unknown" when no type can be determined', () => {
      expect(processor._extractMessageType({})).toBe('unknown');
      expect(processor._extractMessageType({ message: {} })).toBe('unknown');
    });
  });

  describe('process', () => {
    it('should route message type to _processUserMessage', () => {
      const spy = jest.spyOn(processor, '_processUserMessage');
      const raw = { type: 'message', message: { text: 'Hello' } };

      processor.process(raw);

      expect(spy).toHaveBeenCalledWith(raw);
    });

    it('should route stream_start to _processStreamStart', () => {
      const spy = jest.spyOn(processor, '_processStreamStart');
      const raw = { type: 'stream_start', id: 'stream-123' };

      processor.process(raw);

      expect(spy).toHaveBeenCalledWith(raw);
    });

    it('should route delta messages to _processDelta', () => {
      const spy = jest.spyOn(processor, '_processDelta');
      const raw = { v: 'content', seq: 1 };

      processor.process(raw);

      expect(spy).toHaveBeenCalledWith(raw);
    });

    it('should route stream_end to _processStreamEnd', () => {
      const spy = jest.spyOn(processor, '_processStreamEnd');
      const raw = { type: 'stream_end', id: 'stream-123' };

      processor.process(raw);

      expect(spy).toHaveBeenCalledWith(raw);
    });

    it('should route typing_start to _handleTypingIndicator', () => {
      const spy = jest.spyOn(processor, '_handleTypingIndicator');
      const raw = { type: 'typing_start' };

      processor.process(raw);

      expect(spy).toHaveBeenCalledWith(raw);
    });

    it('should emit MESSAGE_UNKNOWN for unknown message types', () => {
      const raw = { unknownField: 'value' };

      processor.process(raw);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UNKNOWN,
        raw,
      );
    });

    it('should emit ERROR on exception', () => {
      processor._processUserMessage = jest.fn(() => {
        throw new Error('Test error');
      });

      processor.process({ type: 'message' });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.ERROR,
        expect.any(Error),
      );
    });

    it.each([
      [
        'stream_start',
        '_processStreamStart',
        { type: 'stream_start', id: 'x' },
      ],
      ['delta', '_processDelta', { v: 'hi', seq: 1 }],
      ['stream_end', '_processStreamEnd', { type: 'stream_end', id: 'x' }],
      ['typing_start', '_handleTypingIndicator', { type: 'typing_start' }],
    ])(
      'should catch exceptions from %s handler and emit ERROR',
      (_label, methodName, raw) => {
        const thrown = new Error(`${methodName} failed`);
        processor[methodName] = jest.fn(() => {
          throw thrown;
        });

        processor.process(raw);

        expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.ERROR, thrown);
      },
    );
  });

  describe('_processStreamStart', () => {
    it('should initialize stream state with message id', () => {
      const raw = { type: 'stream_start', id: 'stream-123' };

      processor._processStreamStart(raw);

      expect(processor.activeStreamId).toBe(MESSAGE_ID_PREFIX + 'stream-123');
      expect(processor.streams.has(MESSAGE_ID_PREFIX + 'stream-123')).toBe(
        true,
      );
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
      expect(processor.streamMessageEmitted).toBe(false);
    });

    it('should extract id from message.messageId', () => {
      const raw = { type: 'stream_start', message: { messageId: 'msg-456' } };

      processor._processStreamStart(raw);

      expect(processor.activeStreamId).toBe(MESSAGE_ID_PREFIX + 'msg-456');
    });

    it('should emit error if no id provided', () => {
      const raw = { type: 'stream_start' };

      processor._processStreamStart(raw);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.ERROR,
        expect.objectContaining({
          message: 'stream_start received without id',
        }),
      );
    });

    it('should store stream with empty text and timestamp', () => {
      const now = Date.now();
      const raw = { type: 'stream_start', id: 'stream-123' };

      processor._processStreamStart(raw);

      const streamData = processor.streams.get(
        MESSAGE_ID_PREFIX + 'stream-123',
      );
      expect(streamData.text).toBe('');
      expect(streamData.timestamp).toBeGreaterThanOrEqual(now);
    });
  });

  describe('_processDelta', () => {
    beforeEach(() => {
      // Setup an active stream
      processor._processStreamStart({ type: 'stream_start', id: 'stream-123' });
    });

    it('should process in-order delta immediately', () => {
      const delta = { v: 'Hello', seq: 1 };

      processor._processDelta(delta);

      const streamData = processor.streams.get(
        MESSAGE_ID_PREFIX + 'stream-123',
      );
      expect(streamData.text).toBe('Hello');
      expect(processor.nextExpectedSeq).toBe(2);
    });

    it('should buffer out-of-order delta', () => {
      const delta = { v: 'World', seq: 3 };

      processor._processDelta(delta);

      expect(processor.pendingDeltas.has(3)).toBe(true);
      expect(processor.pendingDeltas.get(3)).toBe('World');
      expect(processor.nextExpectedSeq).toBe(1); // Still waiting for seq 1
    });

    it('should ignore duplicate deltas (seq < nextExpectedSeq)', () => {
      processor._processDelta({ v: 'First', seq: 1 });
      processor._processDelta({ v: 'Duplicate', seq: 1 });

      const streamData = processor.streams.get(
        MESSAGE_ID_PREFIX + 'stream-123',
      );
      expect(streamData.text).toBe('First');
      expect(processor.nextExpectedSeq).toBe(2);
    });

    it('should apply buffered deltas when gap is filled', () => {
      // Buffer out-of-order deltas first
      processor._processDelta({ v: ' World', seq: 2 });
      processor._processDelta({ v: '!', seq: 3 });

      expect(processor.pendingDeltas.size).toBe(2);

      // Fill the gap with seq 1
      processor._processDelta({ v: 'Hello', seq: 1 });

      const streamData = processor.streams.get(
        MESSAGE_ID_PREFIX + 'stream-123',
      );
      expect(streamData.text).toBe('Hello World!');
      expect(processor.nextExpectedSeq).toBe(4);
      expect(processor.pendingDeltas.size).toBe(0);
    });

    it('should reject invalid sequence numbers', () => {
      const appendSpy = jest.spyOn(processor, '_appendStreamContent');

      processor._processDelta({ v: 'Invalid', seq: -1 });
      processor._processDelta({ v: 'Invalid', seq: 0 });
      processor._processDelta({ v: 'Invalid', seq: null });
      processor._processDelta({ v: 'Invalid', seq: 'string' });

      expect(appendSpy).not.toHaveBeenCalled();
    });

    it('should emit MESSAGE_UPDATED on delta processing', () => {
      processor._processDelta({ v: 'Hello', seq: 1 });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'stream-123',
        expect.objectContaining({
          text: 'Hello',
          status: 'streaming',
        }),
      );
    });

    it('should stop typing on first delta', () => {
      processor.isTypingActive = true;

      processor._processDelta({ v: 'Hello', seq: 1 });

      expect(processor.isTypingActive).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_STOP);
    });

    it('should stop thinking on first delta', () => {
      processor.isThinkingActive = true;

      processor._processDelta({ v: 'Hello', seq: 1 });

      expect(processor.isThinkingActive).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.THINKING_STOP);
    });

    it('should emit deferred streaming message on first delta', () => {
      processor._processDelta({ v: 'Hello', seq: 1 });

      expect(processor.streamMessageEmitted).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({
          id: MESSAGE_ID_PREFIX + 'stream-123',
          type: 'text',
          text: '',
          status: 'streaming',
          direction: 'incoming',
        }),
      );
    });

    it('should fall back to Date.now() for deferred message when stream data is missing', () => {
      // Simulate stream record being evicted between stream_start and first delta
      processor.streams.delete(MESSAGE_ID_PREFIX + 'stream-123');
      const before = Date.now();

      processor._processDelta({ v: 'Hello', seq: 1 });

      const deferred = mockEmit.mock.calls.find(
        ([eventName, payload]) =>
          eventName === SERVICE_EVENTS.MESSAGE_PROCESSED &&
          payload?.status === 'streaming',
      );
      expect(deferred).toBeDefined();
      expect(deferred[1].timestamp).toBeGreaterThanOrEqual(before);
    });

    it.each([
      ['undefined', { seq: 1 }],
      ['null', { v: null, seq: 1 }],
      ['empty string', { v: '', seq: 1 }],
    ])(
      'should treat falsy v as empty content (%s) and still advance sequence',
      (_label, delta) => {
        processor._processDelta(delta);

        const streamData = processor.streams.get(
          MESSAGE_ID_PREFIX + 'stream-123',
        );
        expect(streamData.text).toBe('');
        expect(processor.nextExpectedSeq).toBe(2);
        expect(mockEmit).toHaveBeenCalledWith(
          SERVICE_EVENTS.MESSAGE_UPDATED,
          MESSAGE_ID_PREFIX + 'stream-123',
          expect.objectContaining({ text: '', status: 'streaming' }),
        );
      },
    );
  });

  describe('delta without stream_start (orphan deltas)', () => {
    it('should ignore deltas when no stream_start registered', () => {
      processor._processDelta({ v: 'Hello', seq: 1, id: 'orphan-1' });

      expect(processor.activeStreamId).toBeNull();
      expect(processor.streams.size).toBe(0);
      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.anything(),
      );
      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        expect.anything(),
        expect.anything(),
      );
    });

    it('should emit delivered message from stream_end with content only', () => {
      processor._processDelta({ v: 'ignored', seq: 1 });

      processor._processStreamEnd({
        type: 'stream_end',
        id: 'recovered-b',
        content: 'Full reply from server',
      });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({
          id: MESSAGE_ID_PREFIX + 'recovered-b',
          type: 'text',
          text: 'Full reply from server',
          status: 'delivered',
          direction: 'incoming',
        }),
      );
    });
  });

  describe('_processStreamEnd', () => {
    beforeEach(() => {
      processor._processStreamStart({ type: 'stream_start', id: 'stream-123' });
      processor._processDelta({ v: 'Hello World', seq: 1 });
    });

    it('should finalize stream with final text', () => {
      const raw = { type: 'stream_end', id: 'stream-123' };

      processor._processStreamEnd(raw);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'stream-123',
        expect.objectContaining({
          text: 'Hello World',
          status: 'delivered',
        }),
      );
    });

    it('should use stream_end content over accumulated stream text when provided', () => {
      processor._processStreamEnd({
        type: 'stream_end',
        id: 'stream-123',
        content: 'Authoritative final text',
      });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'stream-123',
        expect.objectContaining({
          text: 'Authoritative final text',
          status: 'delivered',
        }),
      );
    });

    it('should cleanup stream resources', () => {
      const raw = { type: 'stream_end', id: 'stream-123' };

      processor._processStreamEnd(raw);

      expect(processor.streams.has(MESSAGE_ID_PREFIX + 'stream-123')).toBe(
        false,
      );
      expect(processor.activeStreamId).toBeNull();
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
    });

    it('should stop typing/thinking on stream end', () => {
      processor.isTypingActive = true;
      processor.isThinkingActive = true;

      processor._processStreamEnd({ type: 'stream_end', id: 'stream-123' });

      expect(processor.isTypingActive).toBe(false);
      expect(processor.isThinkingActive).toBe(false);
    });

    it('should emit error if no id provided', () => {
      const raw = { type: 'stream_end' };

      processor._processStreamEnd(raw);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.ERROR,
        expect.objectContaining({ message: 'stream_end received without id' }),
      );
    });

    it('should remember final text for duplicate detection', () => {
      processor._processStreamEnd({ type: 'stream_end', id: 'stream-123' });

      expect(processor.recentIncomingTexts).toContain('Hello World');
    });

    it('should handle stream_end with empty text', () => {
      // Create a stream but don't add any content
      processor._resetStreamState();
      processor._processStreamStart({
        type: 'stream_start',
        id: 'empty-stream',
      });

      processor._processStreamEnd({ type: 'stream_end', id: 'empty-stream' });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'empty-stream',
        expect.objectContaining({
          text: '',
          status: 'delivered',
        }),
      );
    });

    it('should treat empty-string content as authoritative final text', () => {
      processor._processStreamEnd({
        type: 'stream_end',
        id: 'stream-123',
        content: '',
      });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'stream-123',
        expect.objectContaining({ text: '', status: 'delivered' }),
      );
      // Empty final text should NOT be remembered for duplicate detection
      expect(processor.recentIncomingTexts).not.toContain('');
    });

    it('should fall back to accumulated text when content is null', () => {
      processor._processStreamEnd({
        type: 'stream_end',
        id: 'stream-123',
        content: null,
      });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'stream-123',
        expect.objectContaining({
          text: 'Hello World',
          status: 'delivered',
        }),
      );
    });
  });

  describe('_isValidSequenceNumber', () => {
    it('should accept valid sequence numbers', () => {
      expect(processor._isValidSequenceNumber(1)).toBe(true);
      expect(processor._isValidSequenceNumber(100)).toBe(true);
      expect(processor._isValidSequenceNumber(STREAM_INITIAL_SEQUENCE)).toBe(
        true,
      );
    });

    it('should reject invalid sequence numbers', () => {
      expect(processor._isValidSequenceNumber(0)).toBe(false);
      expect(processor._isValidSequenceNumber(-1)).toBe(false);
      expect(processor._isValidSequenceNumber(null)).toBe(false);
      expect(processor._isValidSequenceNumber(undefined)).toBe(false);
      expect(processor._isValidSequenceNumber('1')).toBe(false);
      expect(processor._isValidSequenceNumber(NaN)).toBe(false);
    });
  });

  describe('_isFirstDelta', () => {
    it('should return true when nextExpectedSeq is initial and seq is valid', () => {
      processor.nextExpectedSeq = STREAM_INITIAL_SEQUENCE;

      expect(processor._isFirstDelta(1)).toBe(true);
      expect(processor._isFirstDelta(5)).toBe(true);
    });

    it('should return false when stream has already received deltas', () => {
      processor.nextExpectedSeq = 5;

      expect(processor._isFirstDelta(5)).toBe(false);
      expect(processor._isFirstDelta(1)).toBe(false);
    });
  });

  describe('_createStreamingMessage', () => {
    it('should create a properly formatted streaming message', () => {
      const id = 'test-id';
      const timestamp = Date.now();

      const message = processor._createStreamingMessage(id, timestamp);

      expect(message).toEqual({
        id: 'test-id',
        type: 'text',
        text: '',
        timestamp,
        direction: 'incoming',
        status: 'streaming',
      });
    });
  });

  describe('_appendStreamContent', () => {
    it('should return silently when streamId is not in streams map', () => {
      processor._appendStreamContent('missing-stream-id', 'content');

      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('_cleanupStream', () => {
    it('should remove stream from map but preserve stream state when not active', () => {
      processor._processStreamStart({
        type: 'stream_start',
        id: 'active-stream',
      });
      processor._processDelta({ v: 'partial', seq: 1 });

      const activeId = MESSAGE_ID_PREFIX + 'active-stream';
      const orphanId = MESSAGE_ID_PREFIX + 'orphan-stream';

      processor.streams.set(orphanId, { text: 'orphan text', timestamp: 0 });

      processor._cleanupStream(orphanId);

      expect(processor.streams.has(orphanId)).toBe(false);
      expect(processor.streams.has(activeId)).toBe(true);
      expect(processor.activeStreamId).toBe(activeId);
      expect(processor.nextExpectedSeq).toBe(2);
      expect(processor.streamMessageEmitted).toBe(true);
    });

    it('should reset stream state when cleaning up the active stream', () => {
      processor._processStreamStart({
        type: 'stream_start',
        id: 'active-stream',
      });
      processor._processDelta({ v: 'partial', seq: 1 });

      const activeId = MESSAGE_ID_PREFIX + 'active-stream';

      processor._cleanupStream(activeId);

      expect(processor.streams.has(activeId)).toBe(false);
      expect(processor.activeStreamId).toBeNull();
      expect(processor.nextExpectedSeq).toBe(STREAM_INITIAL_SEQUENCE);
      expect(processor.streamMessageEmitted).toBe(false);
    });
  });

  describe('_getMessageType', () => {
    it('should return inner type when push envelope wraps content', () => {
      const raw = { type: 'message', message: { type: 'file' } };

      expect(processor._getMessageType(raw)).toBe('file');
    });

    it('should return raw.type when no inner type wrapping', () => {
      expect(processor._getMessageType({ type: 'stream_end' })).toBe(
        'stream_end',
      );
    });

    it('should return message.type when no top-level type', () => {
      expect(processor._getMessageType({ message: { type: 'text' } })).toBe(
        'text',
      );
    });

    it('should infer "text" from message.text when no explicit type', () => {
      expect(processor._getMessageType({ message: { text: 'Hello' } })).toBe(
        'text',
      );
    });

    it('should infer "media" from message.media when no type or text', () => {
      expect(
        processor._getMessageType({
          message: { media: { url: 'http://example.com' } },
        }),
      ).toBe('media');
    });

    it('should default to "text" when no signals available', () => {
      expect(processor._getMessageType({})).toBe('text');
      expect(processor._getMessageType({ message: {} })).toBe('text');
    });
  });

  describe('_validateMessage', () => {
    it('should return false for null and undefined', () => {
      expect(processor._validateMessage(null)).toBe(false);
      expect(processor._validateMessage(undefined)).toBe(false);
    });

    it('should return false for non-object input', () => {
      expect(processor._validateMessage('string')).toBe(false);
      expect(processor._validateMessage(123)).toBe(false);
      expect(processor._validateMessage(true)).toBe(false);
    });

    it('should return false when type is missing or falsy', () => {
      expect(processor._validateMessage({})).toBe(false);
      expect(processor._validateMessage({ type: undefined })).toBe(false);
      expect(processor._validateMessage({ type: '' })).toBe(false);
      expect(processor._validateMessage({ type: null })).toBe(false);
    });

    it('should return true for a minimally valid message', () => {
      expect(processor._validateMessage({ type: 'text' })).toBe(true);
      expect(processor._validateMessage({ type: 'message', text: 'Hi' })).toBe(
        true,
      );
    });
  });

  describe('_getMessageIdFromRaw', () => {
    it('should extract id from raw.id with prefix', () => {
      expect(processor._getMessageIdFromRaw({ id: '123' })).toBe(
        MESSAGE_ID_PREFIX + '123',
      );
    });

    it('should extract id from raw.message.messageId with prefix', () => {
      const raw = { message: { messageId: 'msg-456' } };
      expect(processor._getMessageIdFromRaw(raw)).toBe(
        MESSAGE_ID_PREFIX + 'msg-456',
      );
    });

    it('should prefer message.messageId over id', () => {
      const raw = {
        id: 'id-from-raw',
        message: { messageId: 'id-from-message' },
      };
      expect(processor._getMessageIdFromRaw(raw)).toBe(
        MESSAGE_ID_PREFIX + 'id-from-message',
      );
    });

    it('should return null when no id found', () => {
      expect(processor._getMessageIdFromRaw({})).toBeNull();
      expect(processor._getMessageIdFromRaw({ message: {} })).toBeNull();
      expect(processor._getMessageIdFromRaw(null)).toBeNull();
    });
  });

  describe('_processQueue', () => {
    it('should be a no-op when already processing', () => {
      processor.isProcessing = true;
      processor.queue.push({ id: '1', type: 'text', text: 'pending' });

      processor._processQueue();

      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.anything(),
      );
      expect(processor.queue).toHaveLength(1);
    });

    it('should be a no-op when queue is empty', () => {
      processor._processQueue();

      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.anything(),
      );
      expect(processor.isProcessing).toBe(false);
    });

    it('should apply messageDelay between queued messages', async () => {
      processor.config.messageDelay = 100;
      processor.queue.push({ id: '1', type: 'text', text: 'first' });
      processor.queue.push({ id: '2', type: 'text', text: 'second' });
      processor.queue.push({ id: '3', type: 'text', text: 'third' });

      processor._processQueue();

      // First emit is synchronous before the first await
      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: '1' }),
      );
      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: '2' }),
      );

      await jest.advanceTimersByTimeAsync(100);
      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: '2' }),
      );
      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: '3' }),
      );

      await jest.advanceTimersByTimeAsync(100);
      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: '3' }),
      );

      expect(processor.isProcessing).toBe(false);
      expect(processor.queue).toHaveLength(0);
    });
  });

  describe('_handleTypingIndicator', () => {
    it('should emit TYPING_START for regular typing', () => {
      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
      expect(processor.isTypingActive).toBe(true);
    });

    it('should emit THINKING_START for AI assistant', () => {
      processor._handleTypingIndicator({
        type: 'typing_start',
        from: 'ai-assistant',
      });

      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.THINKING_START);
      expect(processor.isThinkingActive).toBe(true);
    });

    it('should not show typing if enableTypingIndicator is false', () => {
      processor.config.enableTypingIndicator = false;

      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
      expect(processor.isTypingActive).toBe(false);
    });

    it('should not show typing if streaming has received deltas', () => {
      processor._processStreamStart({ type: 'stream_start', id: 'stream-123' });
      processor._processDelta({ v: 'Hello', seq: 1 });

      mockEmit.mockClear();
      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
    });

    it('should allow typing if stream started but no deltas received', () => {
      processor._processStreamStart({ type: 'stream_start', id: 'stream-123' });

      mockEmit.mockClear();
      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
    });

    it('should auto-stop typing after timeout', () => {
      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(processor.isTypingActive).toBe(true);

      jest.advanceTimersByTime(processor.config.typingTimeout);

      expect(processor.isTypingActive).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_STOP);
    });

    it('should clear the prior auto-stop timer on a subsequent call', () => {
      const clearSpy = jest.spyOn(global, 'clearTimeout');

      processor._handleTypingIndicator({ type: 'typing_start' });
      const firstTimer = processor.typingTimer;
      expect(firstTimer).not.toBeNull();

      processor._handleTypingIndicator({ type: 'typing_start' });

      expect(clearSpy).toHaveBeenCalledWith(firstTimer);
      expect(processor.typingTimer).not.toBeNull();
      expect(processor.typingTimer).not.toBe(firstTimer);
    });
  });

  describe('startTypingOnMessageSent', () => {
    it('should start typing after delay', () => {
      processor.startTypingOnMessageSent();

      expect(processor.isTypingActive).toBe(false);

      jest.advanceTimersByTime(processor.config.typingDelay);

      expect(processor.isTypingActive).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
    });

    it('should not start typing if already active', () => {
      processor.isTypingActive = true;

      processor.startTypingOnMessageSent();
      jest.advanceTimersByTime(processor.config.typingDelay);

      // Should only have the initial true state
      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
    });

    it('should not start typing if disabled', () => {
      processor.config.enableTypingIndicator = false;

      processor.startTypingOnMessageSent();
      jest.advanceTimersByTime(processor.config.typingDelay);

      expect(processor.isTypingActive).toBe(false);
    });

    it('should not emit TYPING_START when thinking is already active', () => {
      processor.isThinkingActive = true;

      processor.startTypingOnMessageSent();
      jest.advanceTimersByTime(processor.config.typingDelay);

      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_START);
      expect(processor.isTypingActive).toBe(false);
      expect(processor.isThinkingActive).toBe(true);
    });

    it('should reset the timer when called twice in quick succession', () => {
      const clearSpy = jest.spyOn(global, 'clearTimeout');

      processor.startTypingOnMessageSent();
      const firstTimer = processor.typingTimer;
      expect(firstTimer).not.toBeNull();

      processor.startTypingOnMessageSent();

      expect(clearSpy).toHaveBeenCalledWith(firstTimer);
      expect(processor.typingTimer).not.toBe(firstTimer);

      // Only one TYPING_START fires after the (second) delay
      jest.advanceTimersByTime(processor.config.typingDelay);

      const typingStartCalls = mockEmit.mock.calls.filter(
        ([eventName]) => eventName === SERVICE_EVENTS.TYPING_START,
      );
      expect(typingStartCalls).toHaveLength(1);
    });
  });

  describe('_stopTyping', () => {
    it('should stop typing and emit event', () => {
      processor.isTypingActive = true;

      processor._stopTyping();

      expect(processor.isTypingActive).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_STOP);
    });

    it('should stop thinking and emit event', () => {
      processor.isThinkingActive = true;

      processor._stopTyping();

      expect(processor.isThinkingActive).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.THINKING_STOP);
    });

    it('should clear typing timer', () => {
      processor._handleTypingIndicator({ type: 'typing_start' });
      expect(processor.typingTimer).not.toBeNull();

      processor._stopTyping();

      expect(processor.typingTimer).toBeNull();
    });

    it('should be a no-op when neither typing nor thinking is active', () => {
      expect(processor.isTypingActive).toBe(false);
      expect(processor.isThinkingActive).toBe(false);
      expect(processor.typingTimer).toBeNull();

      processor._stopTyping();

      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.TYPING_STOP);
      expect(mockEmit).not.toHaveBeenCalledWith(SERVICE_EVENTS.THINKING_STOP);
      expect(processor.typingTimer).toBeNull();
    });
  });

  describe('_processUserMessage', () => {
    it('should normalize and queue valid message', () => {
      const raw = {
        type: 'message',
        message: { text: 'Hello' },
      };

      processor._processUserMessage(raw);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({
          type: 'message',
          text: 'Hello',
          direction: 'incoming',
        }),
      );
    });

    it('should emit error for invalid message when validation fails', () => {
      // Mock _validateMessage to return false to simulate validation failure
      jest.spyOn(processor, '_validateMessage').mockReturnValue(false);

      processor._processUserMessage({
        type: 'message',
        message: { text: 'Hello' },
      });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.ERROR,
        expect.objectContaining({ message: 'Invalid message format' }),
      );
    });

    it('should stop typing on incoming message', () => {
      processor.isTypingActive = true;

      processor._processUserMessage({
        type: 'message',
        message: { text: 'Hello' },
      });

      expect(processor.isTypingActive).toBe(false);
    });

    it('should reject duplicate incoming text', () => {
      processor.recentIncomingTexts = ['Duplicate message'];

      processor._processUserMessage({
        type: 'message',
        message: { text: 'Duplicate message' },
      });

      // MESSAGE_PROCESSED should not be called for duplicate
      expect(mockEmit).not.toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.anything(),
      );
    });

    it('should emit ERROR via inner catch when _normalizeMessage throws', () => {
      const thrown = new Error('normalize boom');
      jest.spyOn(processor, '_normalizeMessage').mockImplementation(() => {
        throw thrown;
      });

      processor._processUserMessage({
        type: 'message',
        message: { text: 'Hello' },
      });

      expect(mockEmit).toHaveBeenCalledWith(SERVICE_EVENTS.ERROR, thrown);
      expect(processor.queue).toHaveLength(0);
    });
  });

  describe('_normalizeMessage', () => {
    it('should normalize text message', () => {
      const raw = {
        type: 'message',
        message: { text: 'Hello', messageId: 'id-123' },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized).toMatchObject({
        id: 'id-123',
        type: 'message',
        text: 'Hello',
        direction: 'incoming',
        status: 'delivered',
      });
    });

    it('should normalize message with media', () => {
      const raw = {
        message: {
          media: { url: 'http://example.com/image.jpg', type: 'image' },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.media).toEqual({
        url: 'http://example.com/image.jpg',
        type: 'image',
      });
    });

    it('should normalize push envelope file message with media_url and caption', () => {
      const raw = {
        type: 'message',
        message: {
          type: 'file',
          media_url: 'https://example.com/bucket/file.pdf',
          caption: 'Privacy policy and terms.',
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.type).toBe('file');
      expect(normalized.media).toBe('https://example.com/bucket/file.pdf');
      expect(normalized.caption).toBe('Privacy policy and terms.');
    });

    it('should normalize message with quick replies', () => {
      const raw = {
        message: {
          text: 'Choose one',
          quick_replies: [{ title: 'Option 1' }, { title: 'Option 2' }],
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.quick_replies).toEqual([
        { title: 'Option 1' },
        { title: 'Option 2' },
      ]);
    });

    it('should normalize message with list_message', () => {
      const raw = {
        message: {
          list_message: {
            list_items: [{ id: '1', title: 'Item 1' }],
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.list_message).toEqual({
        list_items: [{ id: '1', title: 'Item 1' }],
      });
    });

    it('should normalize message with cta_message', () => {
      const raw = {
        message: {
          cta_message: {
            url: 'http://example.com',
            display_text: 'Click here',
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.cta_message).toEqual({
        url: 'http://example.com',
        display_text: 'Click here',
      });
    });

    it('should include metadata if present', () => {
      const raw = {
        message: { text: 'Hello' },
        metadata: { custom: 'data' },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.metadata).toEqual({ custom: 'data' });
    });

    it('should normalize message with interactive product_list', () => {
      const raw = {
        message: {
          text: 'Check our products',
          interactive: {
            type: 'product_list',
            action: {
              name: 'View Products',
              sections: [
                {
                  title: 'Category 1',
                  product_items: [
                    { product_retailer_id: 'prod-1' },
                    { product_retailer_id: 'prod-2' },
                  ],
                },
              ],
            },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.product_list).toEqual({
        text: 'Check our products',
        buttonText: 'View Products',
        sections: [
          {
            title: 'Category 1',
            product_items: [
              { product_retailer_id: 'prod-1' },
              { product_retailer_id: 'prod-2' },
            ],
          },
        ],
      });
    });

    it('should normalize message with interactive header', () => {
      const raw = {
        message: {
          text: 'Hello',
          interactive: {
            header: { text: 'Welcome Header' },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.header).toBe('Welcome Header');
    });

    it('should normalize message with interactive footer', () => {
      const raw = {
        message: {
          text: 'Hello',
          interactive: {
            footer: { text: 'Footer text' },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.footer).toBe('Footer text');
    });

    it('should normalize message with interactive header, footer and product_list', () => {
      const raw = {
        message: {
          text: 'Browse our catalog',
          interactive: {
            type: 'product_list',
            header: { text: 'Our Catalog' },
            footer: { text: 'Tap to view details' },
            action: {
              name: 'See Products',
              sections: [
                {
                  title: 'Best Sellers',
                  product_items: [{ product_retailer_id: 'best-1' }],
                },
              ],
            },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.header).toBe('Our Catalog');
      expect(normalized.footer).toBe('Tap to view details');
      expect(normalized.product_list).toEqual({
        text: 'Browse our catalog',
        buttonText: 'See Products',
        sections: [
          {
            title: 'Best Sellers',
            product_items: [{ product_retailer_id: 'best-1' }],
          },
        ],
      });
    });

    it('should not set product_list for non-product_list interactive types', () => {
      const raw = {
        message: {
          text: 'Hello',
          interactive: {
            type: 'button',
            action: { buttons: [{ title: 'Click me' }] },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.product_list).toBeUndefined();
    });

    it('should not set header/footer when interactive has no header/footer', () => {
      const raw = {
        message: {
          text: 'Hello',
          interactive: {
            type: 'product_list',
            action: { name: 'View', sections: [] },
          },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.header).toBeUndefined();
      expect(normalized.footer).toBeUndefined();
    });

    it('should fall back to generateMessageId when no id is provided', () => {
      const raw = { type: 'message', message: { text: 'Hello' } };

      const normalized = processor._normalizeMessage(raw);

      // generateMessageId returns `msg_<timestamp>_<random>`
      expect(normalized.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    });

    it('should preserve raw.id when message.messageId is absent', () => {
      const raw = { id: 'raw-id-only', type: 'message', message: {} };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.id).toBe('raw-id-only');
    });

    it('should preserve explicit raw.timestamp', () => {
      const fixedTimestamp = 1700000000000;
      const raw = {
        type: 'message',
        message: { text: 'Hello' },
        timestamp: fixedTimestamp,
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.timestamp).toBe(fixedTimestamp);
    });

    it('should preserve truthy raw.persisted', () => {
      const raw = {
        type: 'message',
        message: { text: 'Hello' },
        persisted: true,
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.persisted).toBe(true);
    });

    it('should leave persisted undefined when falsy', () => {
      const raw = {
        type: 'message',
        message: { text: 'Hello' },
        persisted: false,
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.persisted).toBeUndefined();
    });

    it('should not set list_message when list_items is empty', () => {
      const raw = {
        message: {
          text: 'Choose',
          list_message: { list_items: [] },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.list_message).toBeUndefined();
    });

    it('should not set cta_message when only url is provided', () => {
      const raw = {
        message: {
          cta_message: { url: 'http://example.com' },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.cta_message).toBeUndefined();
    });

    it('should not set cta_message when only display_text is provided', () => {
      const raw = {
        message: {
          cta_message: { display_text: 'Click here' },
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.cta_message).toBeUndefined();
    });

    it('should not set caption when caption is not a string', () => {
      const raw = {
        message: {
          type: 'file',
          media_url: 'http://example.com/file.pdf',
          caption: 42,
        },
      };

      const normalized = processor._normalizeMessage(raw);

      expect(normalized.caption).toBeUndefined();
    });
  });

  describe('processBatch', () => {
    it('should process multiple messages', () => {
      const processSpy = jest.spyOn(processor, 'process');
      const messages = [
        { type: 'message', message: { text: 'First' } },
        { type: 'message', message: { text: 'Second' } },
      ];

      processor.processBatch(messages);

      expect(processSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle empty array', () => {
      const processSpy = jest.spyOn(processor, 'process');

      processor.processBatch([]);

      expect(processSpy).not.toHaveBeenCalled();
    });

    it('should default to empty array when called with no argument', () => {
      const processSpy = jest.spyOn(processor, 'process');

      expect(() => processor.processBatch()).not.toThrow();
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('should preserve input order when processing', () => {
      const processed = [];
      processor.on(SERVICE_EVENTS.MESSAGE_PROCESSED, (msg) => {
        if (typeof msg.text === 'string') processed.push(msg.text);
      });

      processor.processBatch([
        { type: 'message', message: { text: 'first', messageId: '1' } },
        { type: 'message', message: { text: 'second', messageId: '2' } },
        { type: 'message', message: { text: 'third', messageId: '3' } },
      ]);

      expect(processed).toEqual(['first', 'second', 'third']);
    });
  });

  describe('clearQueue', () => {
    it('should clear queue and reset processing state', () => {
      processor.queue = [{ id: '1' }, { id: '2' }];
      processor.isProcessing = true;

      processor.clearQueue();

      expect(processor.queue).toEqual([]);
      expect(processor.isProcessing).toBe(false);
    });
  });

  describe('_isDuplicateIncomingText', () => {
    it('should detect duplicate text', () => {
      processor.recentIncomingTexts = ['Hello', 'World'];

      expect(processor._isDuplicateIncomingText('Hello')).toBe(true);
      expect(processor._isDuplicateIncomingText('World')).toBe(true);
      expect(processor._isDuplicateIncomingText('New')).toBe(false);
    });

    it('should return false for empty or null text', () => {
      expect(processor._isDuplicateIncomingText('')).toBe(false);
      expect(processor._isDuplicateIncomingText(null)).toBe(false);
      expect(processor._isDuplicateIncomingText(undefined)).toBe(false);
    });
  });

  describe('_rememberIncomingText', () => {
    it('should store incoming text', () => {
      processor._rememberIncomingText('Hello');

      expect(processor.recentIncomingTexts).toContain('Hello');
    });

    it('should keep only last 5 texts', () => {
      for (let i = 1; i <= 7; i++) {
        processor._rememberIncomingText(`Message ${i}`);
      }

      expect(processor.recentIncomingTexts.length).toBe(5);
      expect(processor.recentIncomingTexts).toContain('Message 7');
      expect(processor.recentIncomingTexts).not.toContain('Message 1');
      expect(processor.recentIncomingTexts).not.toContain('Message 2');
    });

    it('should not store empty strings', () => {
      processor._rememberIncomingText('');
      processor._rememberIncomingText(null);
      processor._rememberIncomingText(undefined);

      expect(processor.recentIncomingTexts.length).toBe(0);
    });
  });

  describe('Complete streaming flow', () => {
    it('should handle complete stream_start -> deltas -> stream_end flow', () => {
      // Start stream
      processor._processStreamStart({ type: 'stream_start', id: 'flow-test' });

      expect(processor.activeStreamId).toBe(MESSAGE_ID_PREFIX + 'flow-test');
      expect(processor.streamMessageEmitted).toBe(false);

      // First delta - should emit deferred message
      processor._processDelta({ v: 'Hello', seq: 1 });

      expect(processor.streamMessageEmitted).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({ id: MESSAGE_ID_PREFIX + 'flow-test' }),
      );

      // More deltas
      processor._processDelta({ v: ' ', seq: 2 });
      processor._processDelta({ v: 'World', seq: 3 });

      const streamData = processor.streams.get(MESSAGE_ID_PREFIX + 'flow-test');
      expect(streamData.text).toBe('Hello World');

      // End stream
      processor._processStreamEnd({ type: 'stream_end', id: 'flow-test' });

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_UPDATED,
        MESSAGE_ID_PREFIX + 'flow-test',
        expect.objectContaining({
          text: 'Hello World',
          status: 'delivered',
        }),
      );

      expect(processor.activeStreamId).toBeNull();
      expect(processor.streams.has(MESSAGE_ID_PREFIX + 'flow-test')).toBe(
        false,
      );
    });

    it('should handle out-of-order deltas correctly', () => {
      processor._processStreamStart({ type: 'stream_start', id: 'ooo-test' });

      // Receive deltas out of order: 3, 1, 2
      processor._processDelta({ v: '!', seq: 3 });
      expect(processor.pendingDeltas.size).toBe(1);

      processor._processDelta({ v: 'Hi', seq: 1 });
      expect(processor.pendingDeltas.size).toBe(1); // seq 3 still pending

      processor._processDelta({ v: ' ', seq: 2 });
      expect(processor.pendingDeltas.size).toBe(0); // All applied

      const streamData = processor.streams.get(MESSAGE_ID_PREFIX + 'ooo-test');
      expect(streamData.text).toBe('Hi !');
    });
  });
});
