import { sanitizeForTTS } from '../../src/modules/voice/sanitizeForTTS';

describe('sanitizeForTTS', () => {
  // -- Guard clauses -------------------------------------------------------

  describe('guard clauses', () => {
    it('returns empty string for null', () => {
      expect(sanitizeForTTS(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(sanitizeForTTS(undefined)).toBe('');
    });

    it('returns empty string for number', () => {
      expect(sanitizeForTTS(42)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(sanitizeForTTS('')).toBe('');
    });
  });

  // -- Punctuation-only guard -----------------------------------------------

  describe('punctuation-only guard', () => {
    it('returns empty for lone question mark', () => {
      expect(sanitizeForTTS('?')).toBe('');
    });

    it('returns empty for lone exclamation mark', () => {
      expect(sanitizeForTTS('!')).toBe('');
    });

    it('returns empty for multiple punctuation marks', () => {
      expect(sanitizeForTTS('?!...')).toBe('');
    });

    it('returns empty for punctuation with spaces', () => {
      expect(sanitizeForTTS(' ? ! ')).toBe('');
    });

    it('returns empty when only punctuation remains after sanitization', () => {
      expect(sanitizeForTTS('**?**')).toBe('');
    });

    it('preserves text that has letters alongside punctuation', () => {
      expect(sanitizeForTTS('Ok?')).toBe('Ok?');
    });

    it('preserves text that has numbers alongside punctuation', () => {
      expect(sanitizeForTTS('R$ 49,90.')).toBe('R$ 49,90.');
    });
  });

  // -- Plain text passthrough ----------------------------------------------

  describe('plain text passthrough', () => {
    it('preserves simple text', () => {
      expect(sanitizeForTTS('Hello world')).toBe('Hello world');
    });

    it('preserves text with punctuation', () => {
      expect(sanitizeForTTS('How can I help you?')).toBe('How can I help you?');
    });

    it('preserves numbers and currency', () => {
      expect(sanitizeForTTS('O total é R$ 1.299,90')).toBe(
        'O total é R$ 1.299,90',
      );
    });

    it('preserves question marks', () => {
      expect(sanitizeForTTS('Posso ajudar com algo mais?')).toBe(
        'Posso ajudar com algo mais?',
      );
    });

    it('preserves exclamation marks', () => {
      expect(sanitizeForTTS('Compra realizada com sucesso!')).toBe(
        'Compra realizada com sucesso!',
      );
    });
  });

  // -- URL removal ---------------------------------------------------------

  describe('URL replacement', () => {
    it('replaces standalone https URL with "link"', () => {
      expect(sanitizeForTTS('https://example.com')).toBe('link');
    });

    it('replaces standalone http URL with "link"', () => {
      expect(sanitizeForTTS('http://example.com')).toBe('link');
    });

    it('replaces URL embedded in sentence with "link"', () => {
      expect(sanitizeForTTS('Veja em https://loja.com/produto agora')).toBe(
        'Veja em link agora',
      );
    });

    it('replaces URL with query string', () => {
      expect(sanitizeForTTS('Link: https://shop.com/p?id=123&ref=abc')).toBe(
        'Link: link',
      );
    });

    it('replaces URL with path and hash', () => {
      expect(sanitizeForTTS('Acesse https://docs.io/guide#section ok')).toBe(
        'Acesse link ok',
      );
    });

    it('replaces multiple URLs', () => {
      expect(
        sanitizeForTTS('Links: https://a.com e https://b.com aqui'),
      ).toBe('Links: link e link aqui');
    });
  });

  // -- Markdown removal ----------------------------------------------------

  describe('markdown removal', () => {
    it('removes bold markers **text**', () => {
      expect(sanitizeForTTS('Isso é **muito importante** aqui')).toBe(
        'Isso é muito importante aqui',
      );
    });

    it('removes italic markers *text*', () => {
      expect(sanitizeForTTS('Texto em *itálico* aqui')).toBe(
        'Texto em itálico aqui',
      );
    });

    it('removes bold markers __text__', () => {
      expect(sanitizeForTTS('Texto __sublinhado__ aqui')).toBe(
        'Texto sublinhado aqui',
      );
    });

    it('removes italic markers _text_', () => {
      expect(sanitizeForTTS('Texto _itálico_ aqui')).toBe(
        'Texto itálico aqui',
      );
    });

    it('removes nested bold+italic ***text***', () => {
      expect(sanitizeForTTS('Texto ***negrito itálico*** aqui')).toBe(
        'Texto negrito itálico aqui',
      );
    });

    it('handles nested **bold *italic* bold**', () => {
      const result = sanitizeForTTS('Texto **negrito *itálico* negrito** aqui');
      expect(result).not.toContain('*');
      expect(result).toContain('negrito');
      expect(result).toContain('itálico');
    });

    it('removes markdown links keeping text', () => {
      expect(
        sanitizeForTTS(
          'Clique [aqui](https://example.com) para continuar',
        ),
      ).toBe('Clique aqui para continuar');
    });

    it('removes markdown images entirely', () => {
      expect(
        sanitizeForTTS('Veja ![produto](https://img.com/a.jpg) abaixo'),
      ).toBe('Veja abaixo');
    });

    it('removes heading markers', () => {
      expect(sanitizeForTTS('## Título da Seção')).toBe('Título da Seção');
    });

    it('removes h1 markers', () => {
      expect(sanitizeForTTS('# Título Principal')).toBe('Título Principal');
    });

    it('removes inline code backticks keeping content', () => {
      expect(sanitizeForTTS('Use o comando `npm install`')).toBe(
        'Use o comando npm install',
      );
    });

    it('removes fenced code blocks', () => {
      expect(
        sanitizeForTTS('Antes ```js\nconsole.log(1);\n``` depois'),
      ).toBe('Antes depois');
    });

    it('removes bullet markers with dash', () => {
      expect(sanitizeForTTS('- Item um')).toBe('Item um');
    });

    it('removes bullet markers with asterisk', () => {
      expect(sanitizeForTTS('* Item dois')).toBe('Item dois');
    });

    it('removes bullet markers with plus', () => {
      expect(sanitizeForTTS('+ Item três')).toBe('Item três');
    });
  });

  // -- HTML removal --------------------------------------------------------

  describe('HTML removal', () => {
    it('strips bold tags', () => {
      expect(sanitizeForTTS('Hello <b>world</b>')).toBe('Hello world');
    });

    it('strips anchor tags keeping text', () => {
      expect(
        sanitizeForTTS('Click <a href="https://x.com">here</a> now'),
      ).toBe('Click here now');
    });

    it('strips self-closing tags', () => {
      expect(sanitizeForTTS('Line<br/>break')).toBe('Linebreak');
    });
  });

  // -- Whitespace normalization -------------------------------------------

  describe('whitespace normalization', () => {
    it('collapses multiple spaces', () => {
      expect(sanitizeForTTS('Hello     world')).toBe('Hello world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(sanitizeForTTS('  Hello world  ')).toBe('Hello world');
    });

    it('converts newlines to spaces', () => {
      expect(sanitizeForTTS('Line one\nLine two')).toBe('Line one Line two');
    });

    it('collapses whitespace left after replacements', () => {
      expect(
        sanitizeForTTS('See https://example.com for info'),
      ).toBe('See link for info');
    });
  });

  // -- Real-world agent responses -----------------------------------------

  describe('real-world agent responses', () => {
    it('cleans product recommendation with URL and bold', () => {
      const input =
        'Recomendo o **Produto X**. Veja mais em https://loja.com/produto-x';
      const result = sanitizeForTTS(input);
      expect(result).toBe('Recomendo o Produto X. Veja mais em link');
      expect(result).not.toContain('**');
      expect(result).not.toContain('https');
    });

    it('cleans markdown link response', () => {
      const input =
        'Acesse [nossa página](https://help.com/faq) ou entre em contato.';
      expect(sanitizeForTTS(input)).toBe(
        'Acesse nossa página ou entre em contato.',
      );
    });

    it('cleans mixed markdown and URLs', () => {
      const input =
        '**Promoção!** Confira em https://loja.com/promo e *aproveite*.';
      const result = sanitizeForTTS(input);
      expect(result).not.toContain('**');
      expect(result).not.toContain('https');
      expect(result).not.toContain('*');
      expect(result).toContain('Promoção!');
      expect(result).toContain('aproveite');
    });

    it('cleans heading + bullet list', () => {
      const input = '## Opções\n- Produto A\n- Produto B\n- Produto C';
      const result = sanitizeForTTS(input);
      expect(result).not.toContain('#');
      expect(result).not.toContain('-');
      expect(result).toContain('Opções');
      expect(result).toContain('Produto A');
    });

    it('strips code block from technical answer', () => {
      const input =
        'Execute o seguinte: ```bash\nnpm install\n``` e reinicie.';
      const result = sanitizeForTTS(input);
      expect(result).toBe('Execute o seguinte: e reinicie.');
    });

    it('replaces URL with "link" in mixed content', () => {
      const input =
        '**Promoção!** Confira em https://loja.com/promo e *aproveite*.';
      const result = sanitizeForTTS(input);
      expect(result).toContain('link');
      expect(result).not.toContain('https');
    });

    it('preserves natural sentences with numbers', () => {
      expect(
        sanitizeForTTS('São 3 opções com preços a partir de R$ 49,90.'),
      ).toBe('São 3 opções com preços a partir de R$ 49,90.');
    });

    it('preserves sentences with interrogation', () => {
      expect(
        sanitizeForTTS('Qual das 3 opções você prefere?'),
      ).toBe('Qual das 3 opções você prefere?');
    });
  });
});
