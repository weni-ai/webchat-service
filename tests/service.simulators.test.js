import WeniWebchatService from '../src/index';
import { installBrowserMocks, makeConfig } from './_helpers/serviceMocks';

describe('WeniWebchatService — local simulators', () => {
  let service;

  beforeEach(() => {
    installBrowserMocks();
    service = new WeniWebchatService(makeConfig());
    service.session.createNewSession();
  });

  afterEach(() => {
    if (service) {
      service.destroy();
      service = null;
    }
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // simulateMessageReceived
  // ---------------------------------------------------------------------------
  describe('simulateMessageReceived()', () => {
    it('forwards the message to messageProcessor.process with persisted: true', () => {
      const processSpy = jest
        .spyOn(service.messageProcessor, 'process')
        .mockImplementation(() => {});

      const incoming = {
        id: 'sim_1',
        type: 'text',
        text: 'Hello from server',
        direction: 'incoming',
      };

      service.simulateMessageReceived(incoming);

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy).toHaveBeenCalledWith({
        ...incoming,
        persisted: true,
      });
    });

    it('overwrites a falsy persisted flag on the input', () => {
      const processSpy = jest
        .spyOn(service.messageProcessor, 'process')
        .mockImplementation(() => {});

      service.simulateMessageReceived({
        id: 'sim_2',
        type: 'text',
        text: 'x',
        persisted: false,
      });

      expect(processSpy.mock.calls[0][0].persisted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // simulateMessageSent
  // ---------------------------------------------------------------------------
  describe('simulateMessageSent()', () => {
    it('builds an outgoing/sent text message from a string input', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');
      const lastSpy = jest.spyOn(service.session, 'setLastMessageSentAt');

      service.simulateMessageSent('Hello');

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(addSpy.mock.calls[0][0]).toMatchObject({
        type: 'text',
        text: 'Hello',
        direction: 'outgoing',
        status: 'sent',
      });
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text', text: 'Hello' }),
      );
      expect(lastSpy).toHaveBeenCalledTimes(1);
      expect(typeof lastSpy.mock.calls[0][0]).toBe('number');
    });

    it('honors options when input is a string (e.g. id, metadata)', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent('Hi', {
        id: 'custom_id',
        metadata: { ts: 123 },
      });

      expect(addSpy.mock.calls[0][0]).toMatchObject({
        id: 'custom_id',
        type: 'text',
        text: 'Hi',
        direction: 'outgoing',
        status: 'sent',
        metadata: { ts: 123 },
      });
    });

    it('uses buildTextMessage when input is an object with type === "text"', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent({
        type: 'text',
        text: 'Object text',
        id: 'tx_1',
      });

      expect(addSpy.mock.calls[0][0]).toMatchObject({
        id: 'tx_1',
        type: 'text',
        text: 'Object text',
        direction: 'outgoing',
        status: 'sent',
      });
    });

    it('falls back to "" when input has type=text without a text field (line 349 || branch)', () => {
      // Covers the right-hand side of `input.text || ''` at line 349 of
      // src/index.js, where the caller sends a text-shaped object with no
      // `text` property.
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent({ type: 'text', id: 'tx_empty' });

      expect(addSpy.mock.calls[0][0]).toMatchObject({
        id: 'tx_empty',
        type: 'text',
        text: '',
        direction: 'outgoing',
        status: 'sent',
      });
    });

    it('falls back to "" when input.text is an empty string', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent({ type: 'text', text: '', id: 'tx_blank' });

      expect(addSpy.mock.calls[0][0].text).toBe('');
    });

    it.each([
      ['image', 'data:image/png;base64,xxx'],
      ['video', 'data:video/mp4;base64,xxx'],
      ['audio', 'data:audio/mpeg;base64,xxx'],
      ['file', 'data:application/pdf;base64,xxx'],
    ])(
      'uses buildMediaMessage for object input with type=%s',
      (type, media) => {
        const addSpy = jest.spyOn(service.state, 'addMessage');

        service.simulateMessageSent({
          type,
          media,
          id: `media_${type}`,
          metadata: { foo: 'bar' },
        });

        expect(addSpy.mock.calls[0][0]).toMatchObject({
          id: `media_${type}`,
          type,
          media,
          direction: 'outgoing',
          status: 'sent',
          metadata: { foo: 'bar' },
        });
      },
    );

    it('falls through to buildTextMessage with String(input.text || "") for unknown object types', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent({
        type: 'totally_unknown',
        text: 'fallback text',
        id: 'fb_1',
      });

      expect(addSpy.mock.calls[0][0]).toMatchObject({
        id: 'fb_1',
        type: 'text',
        text: 'fallback text',
        direction: 'outgoing',
        status: 'sent',
      });
    });

    it('coerces numeric/missing text to string in the fallback branch', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent({ type: 'totally_unknown' });
      expect(addSpy.mock.calls[0][0].text).toBe('');

      service.simulateMessageSent({ type: 'totally_unknown', text: 42 });
      expect(addSpy.mock.calls[1][0].text).toBe('42');
    });

    it('returns silently for non-string non-object input', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');
      const appendSpy = jest.spyOn(service.session, 'appendToConversation');
      const lastSpy = jest.spyOn(service.session, 'setLastMessageSentAt');

      const result = service.simulateMessageSent(undefined);

      expect(result).toBeUndefined();
      expect(addSpy).not.toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
      expect(lastSpy).not.toHaveBeenCalled();
    });

    it('returns silently for null input', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent(null);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('returns silently for number input', () => {
      const addSpy = jest.spyOn(service.state, 'addMessage');

      service.simulateMessageSent(42);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('updates lastMessageSentAt for every non-early-return branch', () => {
      const lastSpy = jest.spyOn(service.session, 'setLastMessageSentAt');

      service.simulateMessageSent('a');
      service.simulateMessageSent({ type: 'text', text: 'b' });
      service.simulateMessageSent({ type: 'image', media: 'm' });
      service.simulateMessageSent({ type: 'unknown', text: 'c' });

      expect(lastSpy).toHaveBeenCalledTimes(4);
    });
  });
});
