import {
  COMPONENT_TYPES,
  STREAM_PHASES,
  isCompleteHttpUrl,
  normalizeComponentHint,
  normalizeCtaMessage,
  normalizeListMessage,
  normalizeQuickReplies,
  normalizeStreamComponent,
  normalizeStreamEndComponents,
  stripTransientStreamingFields,
  upsertComponentHint,
  warnComponentContract,
} from '../streamComponents';

describe('streamComponents utilities', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constants', () => {
    it('exposes canonical component types and stream phases', () => {
      expect(COMPONENT_TYPES).toEqual({
        QUICK_REPLIES: 'quick_replies',
        LIST_MESSAGE: 'list_message',
        CTA_MESSAGE: 'cta_message',
      });
      expect(STREAM_PHASES).toEqual({
        STREAMING_TEXT: 'streaming_text',
        AWAITING_COMPONENTS: 'awaiting_components',
        COMPLETED: 'completed',
      });
    });
  });

  describe('isCompleteHttpUrl', () => {
    it('accepts complete absolute http and https URLs', () => {
      expect(isCompleteHttpUrl('https://loja.example/pedidos/48213')).toBe(
        true,
      );
      expect(isCompleteHttpUrl('http://localhost:3000/track')).toBe(true);
      expect(isCompleteHttpUrl('  https://example.com/a?b=1  ')).toBe(true);
    });

    it('rejects partial, relative, blank, or non-http(s) URLs', () => {
      expect(isCompleteHttpUrl('')).toBe(false);
      expect(isCompleteHttpUrl('   ')).toBe(false);
      expect(isCompleteHttpUrl(null)).toBe(false);
      expect(isCompleteHttpUrl(123)).toBe(false);
      expect(isCompleteHttpUrl('https://')).toBe(false);
      expect(isCompleteHttpUrl('https:///no-host')).toBe(false);
      expect(isCompleteHttpUrl('/relative/path')).toBe(false);
      expect(isCompleteHttpUrl('javascript:alert(1)')).toBe(false);
      expect(isCompleteHttpUrl('data:text/html,hi')).toBe(false);
      expect(isCompleteHttpUrl('ftp://files.example.com/a')).toBe(false);
    });
  });

  describe('normalizeQuickReplies', () => {
    it('accepts non-empty strings and legacy objects, filtering blank entries', () => {
      expect(
        normalizeQuickReplies([
          'Expressa · até 2h',
          '   ',
          { type: 'text', title: 'Retirar na loja', payload: 'pickup' },
          { title: '' },
          42,
        ]),
      ).toEqual([
        'Expressa · até 2h',
        { type: 'text', title: 'Retirar na loja', payload: 'pickup' },
      ]);
    });

    it('returns undefined for empty or non-array inputs', () => {
      expect(normalizeQuickReplies([])).toBeUndefined();
      expect(normalizeQuickReplies(['  '])).toBeUndefined();
      expect(normalizeQuickReplies('not-an-array')).toBeUndefined();
      expect(normalizeQuickReplies(null)).toBeUndefined();
    });
  });

  describe('normalizeListMessage', () => {
    it('normalizes valid list_message preserving optional item_count and descriptions', () => {
      const result = normalizeListMessage({
        button_text: 'Ver 9 ofertas',
        item_count: 9,
        list_items: [
          {
            uuid: 'item-1',
            title: 'Café em grãos 500g',
            description: 'R$ 34,90',
          },
          { uuid: 'item-2', title: 'Azeite 500ml' },
          { uuid: '', title: 'Missing uuid' },
        ],
      });

      expect(result).toEqual({
        button_text: 'Ver 9 ofertas',
        item_count: 9,
        list_items: [
          {
            uuid: 'item-1',
            title: 'Café em grãos 500g',
            description: 'R$ 34,90',
          },
          { uuid: 'item-2', title: 'Azeite 500ml' },
        ],
      });
    });

    it('omits item_count when absent or not a positive integer', () => {
      const result = normalizeListMessage({
        button_text: 'Ver receitas',
        item_count: 0,
        list_items: [{ uuid: 'r1', title: 'Bolo' }],
      });

      expect(result).toEqual({
        button_text: 'Ver receitas',
        list_items: [{ uuid: 'r1', title: 'Bolo' }],
      });
      expect('item_count' in (result as object)).toBe(false);
    });

    it('returns undefined when button_text or valid list_items are missing', () => {
      expect(normalizeListMessage(null)).toBeUndefined();
      expect(
        normalizeListMessage({ button_text: '', list_items: [] }),
      ).toBeUndefined();
      expect(
        normalizeListMessage({
          button_text: 'Ver',
          list_items: [{ uuid: '', title: 'No uuid' }],
        }),
      ).toBeUndefined();
    });
  });

  describe('normalizeCtaMessage', () => {
    it('normalizes valid cta_message and unescapes JSON-escaped URL slashes', () => {
      expect(
        normalizeCtaMessage({
          display_text: 'Acompanhar pedido',
          url: 'https:\\/\\/loja.example\\/pedidos\\/48213\\/rastreio',
        }),
      ).toEqual({
        display_text: 'Acompanhar pedido',
        url: 'https://loja.example/pedidos/48213/rastreio',
      });
    });

    it('rejects partial, non-http, or missing display_text CTA payloads', () => {
      expect(normalizeCtaMessage(null)).toBeUndefined();
      expect(
        normalizeCtaMessage({ display_text: 'Abrir', url: 'https://' }),
      ).toBeUndefined();
      expect(
        normalizeCtaMessage({
          display_text: 'Abrir',
          url: 'javascript:alert(1)',
        }),
      ).toBeUndefined();
      expect(
        normalizeCtaMessage({
          display_text: '   ',
          url: 'https://loja.example/ok',
        }),
      ).toBeUndefined();
      expect(
        normalizeCtaMessage({ display_text: 'Abrir', url: 123 }),
      ).toBeUndefined();
    });
  });

  describe('normalizeComponentHint', () => {
    it('normalizes wire hint to camelCase and preserves list itemCount', () => {
      const result = normalizeComponentHint(
        {
          type: 'stream_component_hint',
          id: 'stream-1',
          component_type: 'list_message',
          labels: ['Ver 9 ofertas'],
          count: 1,
          item_count: 9,
          persisted: true,
        },
        'msg_stream-1',
      );

      expect(result).toEqual({
        hint: {
          componentType: 'list_message',
          labels: ['Ver 9 ofertas'],
          count: 1,
          itemCount: 9,
        },
      });
    });

    it('ignores item_count on non-list hints and strips any accidental CTA url', () => {
      const result = normalizeComponentHint(
        {
          component_type: 'cta_message',
          labels: ['Acompanhar pedido', ''],
          count: 1,
          item_count: 5,
          url: 'https://secret.example/order/999',
        },
        'msg_1',
      );

      expect(result.hint).toEqual({
        componentType: 'cta_message',
        labels: ['Acompanhar pedido'],
        count: 1,
      });
      expect('url' in (result.hint as object)).toBe(false);
      expect('itemCount' in (result.hint as object)).toBe(false);
    });

    it('accepts hints without labels and omits invalid count', () => {
      const result = normalizeComponentHint({
        component_type: 'quick_replies',
        count: 3,
      });

      expect(result.hint).toEqual({
        componentType: 'quick_replies',
        count: 3,
      });

      const noCount = normalizeComponentHint({
        component_type: 'quick_replies',
        labels: ['   '],
        count: 0,
      });

      expect(noCount.hint).toEqual({
        componentType: 'quick_replies',
      });
    });

    it('returns a structured warning for non-object or unknown component_type', () => {
      expect(normalizeComponentHint(null, 'msg_1')).toEqual({
        warning: {
          operation: 'normalize-component-hint',
          messageId: 'msg_1',
          reason: 'invalid_payload',
        },
      });

      expect(
        normalizeComponentHint({ component_type: 'catalog_message' }, 'msg_2'),
      ).toEqual({
        warning: {
          operation: 'normalize-component-hint',
          messageId: 'msg_2',
          componentType: 'catalog_message',
          reason: 'invalid_component_type',
        },
      });

      expect(normalizeComponentHint({ component_type: 123 }, 'msg_3')).toEqual({
        warning: {
          operation: 'normalize-component-hint',
          messageId: 'msg_3',
          componentType: 'unknown',
          reason: 'invalid_component_type',
        },
      });

      for (const inheritedKey of ['constructor', 'toString', 'hasOwnProperty']) {
        expect(
          normalizeComponentHint({ component_type: inheritedKey }, 'msg_4'),
        ).toEqual({
          warning: {
            operation: 'normalize-component-hint',
            messageId: 'msg_4',
            componentType: inheritedKey,
            reason: 'invalid_component_type',
          },
        });
      }
    });
  });

  describe('upsertComponentHint', () => {
    it('appends new component types and replaces existing ones idempotently', () => {
      const first = upsertComponentHint([], {
        componentType: 'quick_replies',
        count: 3,
      });
      const second = upsertComponentHint(first, {
        componentType: 'cta_message',
        labels: ['Track'],
        count: 1,
      });
      const replaced = upsertComponentHint(second, {
        componentType: 'quick_replies',
        labels: ['Yes', 'No'],
        count: 2,
      });

      expect(replaced).toEqual([
        { componentType: 'quick_replies', labels: ['Yes', 'No'], count: 2 },
        { componentType: 'cta_message', labels: ['Track'], count: 1 },
      ]);
      expect(first).toHaveLength(1);
    });
  });

  describe('normalizeStreamComponent', () => {
    it('normalizes valid quick_replies, list_message, and cta_message frames', () => {
      expect(
        normalizeStreamComponent({
          component_type: 'quick_replies',
          quick_replies: ['Sim', 'Não'],
        }),
      ).toEqual({
        componentType: 'quick_replies',
        payload: ['Sim', 'Não'],
      });

      expect(
        normalizeStreamComponent({
          component_type: 'list_message',
          list_message: {
            button_text: 'Ver 2 ofertas',
            item_count: 2,
            list_items: [
              { uuid: '1', title: 'A' },
              { uuid: '2', title: 'B' },
            ],
          },
        }),
      ).toEqual({
        componentType: 'list_message',
        payload: {
          button_text: 'Ver 2 ofertas',
          item_count: 2,
          list_items: [
            { uuid: '1', title: 'A' },
            { uuid: '2', title: 'B' },
          ],
        },
      });

      expect(
        normalizeStreamComponent({
          component_type: 'cta_message',
          cta_message: {
            display_text: 'Abrir portal',
            url: 'https://loja.example/trocas/48213',
          },
        }),
      ).toEqual({
        componentType: 'cta_message',
        payload: {
          display_text: 'Abrir portal',
          url: 'https://loja.example/trocas/48213',
        },
      });
    });

    it('returns warnings for malformed component frames', () => {
      expect(normalizeStreamComponent('bad', 'msg_1').warning).toEqual({
        operation: 'normalize-stream-component',
        messageId: 'msg_1',
        reason: 'invalid_payload',
      });

      expect(
        normalizeStreamComponent({ component_type: 'unknown_kind' }, 'msg_2')
          .warning,
      ).toEqual({
        operation: 'normalize-stream-component',
        messageId: 'msg_2',
        componentType: 'unknown_kind',
        reason: 'invalid_component_type',
      });

      expect(
        normalizeStreamComponent({ component_type: 'constructor' }, 'msg_2b')
          .warning,
      ).toEqual({
        operation: 'normalize-stream-component',
        messageId: 'msg_2b',
        componentType: 'constructor',
        reason: 'invalid_component_type',
      });

      expect(
        normalizeStreamComponent(
          {
            component_type: 'cta_message',
            cta_message: { display_text: 'Abrir', url: 'https://' },
          },
          'msg_3',
        ).warning,
      ).toEqual({
        operation: 'normalize-stream-component',
        messageId: 'msg_3',
        componentType: 'cta_message',
        reason: 'invalid_cta_payload',
      });

      expect(
        normalizeStreamComponent(
          {
            component_type: 'quick_replies',
            quick_replies: [],
          },
          'msg_4',
        ).warning,
      ).toEqual({
        operation: 'normalize-stream-component',
        messageId: 'msg_4',
        componentType: 'quick_replies',
        reason: 'invalid_component_payload',
      });
    });
  });

  describe('normalizeStreamEndComponents', () => {
    it('extracts multiple valid components and reports invalid siblings independently', () => {
      const result = normalizeStreamEndComponents(
        {
          type: 'stream_end',
          id: 's1',
          content: 'Escolha:',
          quick_replies: ['Sim', 'Não'],
          list_message: {
            button_text: 'Ver 1 oferta',
            item_count: 1,
            list_items: [{ uuid: 'u1', title: 'Café' }],
          },
          cta_message: {
            display_text: 'Link quebrado',
            url: 'javascript:alert(1)',
          },
        },
        'msg_s1',
      );

      expect(result.components).toEqual({
        quick_replies: ['Sim', 'Não'],
        list_message: {
          button_text: 'Ver 1 oferta',
          item_count: 1,
          list_items: [{ uuid: 'u1', title: 'Café' }],
        },
      });
      expect(result.warnings).toEqual([
        {
          operation: 'normalize-stream-component',
          messageId: 'msg_s1',
          componentType: 'cta_message',
          reason: 'invalid_cta_payload',
        },
      ]);
    });

    it('handles non-object input and invalid quick_replies/list_message', () => {
      expect(normalizeStreamEndComponents(null)).toEqual({
        components: {},
        warnings: [],
      });

      const invalid = normalizeStreamEndComponents(
        {
          quick_replies: [],
          list_message: { button_text: '', list_items: [] },
          cta_message: {
            display_text: 'Acompanhar',
            url: 'https://loja.example/ok',
          },
        },
        'msg_s2',
      );

      expect(invalid.components).toEqual({
        cta_message: {
          display_text: 'Acompanhar',
          url: 'https://loja.example/ok',
        },
      });
      expect(invalid.warnings).toHaveLength(2);
    });
  });

  describe('warnComponentContract', () => {
    it('logs module prefix and structured PII-free context', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      warnComponentContract(
        'MessageProcessor',
        'invalid component hint discarded',
        {
          operation: 'normalize-component-hint',
          messageId: 'msg_1',
          componentType: 'cta_message',
          reason: 'invalid_component_type',
        },
      );

      expect(warnSpy).toHaveBeenCalledWith(
        'MessageProcessor: invalid component hint discarded',
        {
          operation: 'normalize-component-hint',
          messageId: 'msg_1',
          componentType: 'cta_message',
          reason: 'invalid_component_type',
        },
      );

      warnComponentContract('HistoryManager', 'stream_text_end ignored', {
        operation: 'stream-text-end',
        reason: 'missing_id',
      });

      expect(warnSpy).toHaveBeenLastCalledWith(
        'HistoryManager: stream_text_end ignored',
        {
          operation: 'stream-text-end',
          reason: 'missing_id',
        },
      );
    });
  });

  describe('stripTransientStreamingFields', () => {
    it('strips componentHints and streamPhase and normalizes streaming status without mutating input', () => {
      const live = {
        id: 'msg_1',
        type: 'text',
        text: 'Partial',
        status: 'streaming',
        streamPhase: 'streaming_text',
        componentHints: [{ componentType: 'quick_replies', count: 3 }],
      };

      const sanitized = stripTransientStreamingFields(live);

      expect(sanitized).toEqual({
        id: 'msg_1',
        type: 'text',
        text: 'Partial',
        status: 'delivered',
      });
      expect('componentHints' in sanitized).toBe(false);
      expect('streamPhase' in sanitized).toBe(false);
      // Original live object untouched
      expect(live.status).toBe('streaming');
      expect(live.streamPhase).toBe('streaming_text');
      expect(live.componentHints).toHaveLength(1);
    });

    it('returns the same reference when no transient fields are present or value is non-object', () => {
      const clean = { id: 'msg_2', text: 'Done', status: 'delivered' };
      expect(stripTransientStreamingFields(clean)).toBe(clean);
      expect(stripTransientStreamingFields(null)).toBeNull();
    });
  });
});
