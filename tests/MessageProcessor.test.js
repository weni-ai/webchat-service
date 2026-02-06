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
  });

  describe('_initializeSyntheticStream (delta without stream_start)', () => {
    it('should create synthetic stream when delta arrives without stream_start', () => {
      const delta = { v: 'Hello', seq: 1, id: 'synthetic-123' };

      processor._processDelta(delta);

      expect(processor.activeStreamId).toBe(
        MESSAGE_ID_PREFIX + 'synthetic-123',
      );
      expect(processor.streams.has(MESSAGE_ID_PREFIX + 'synthetic-123')).toBe(
        true,
      );
      expect(processor.streamMessageEmitted).toBe(true);
    });

    it('should emit streaming message immediately for synthetic stream', () => {
      const delta = { v: 'Hello', seq: 1, id: 'synthetic-123' };

      processor._processDelta(delta);

      expect(mockEmit).toHaveBeenCalledWith(
        SERVICE_EVENTS.MESSAGE_PROCESSED,
        expect.objectContaining({
          id: MESSAGE_ID_PREFIX + 'synthetic-123',
          status: 'streaming',
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
