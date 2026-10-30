import { TextChunker } from "../../src/modules/voice/TextChunker";

describe("TextChunker", () => {
  let chunker;

  beforeEach(() => {
    chunker = new TextChunker();
  });

  describe("addText", () => {
    it("returns null for short text without delimiter", () => {
      expect(chunker.addText("hello")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(chunker.addText("")).toBeNull();
    });

    it("returns null for non-string input", () => {
      expect(chunker.addText(null)).toBeNull();
      expect(chunker.addText(undefined)).toBeNull();
      expect(chunker.addText(42)).toBeNull();
    });

    it("returns chunk at period boundary when minChunkSize met", () => {
      const text = "This is a long enough sentence.";
      const result = chunker.addText(text);
      expect(result).toBe("This is a long enough sentence.");
    });

    it("returns chunk at exclamation boundary", () => {
      const text = "This is exciting news!";
      const result = chunker.addText(text);
      expect(result).toBe("This is exciting news!");
    });

    it("returns chunk at question mark boundary", () => {
      const text = "Is this working correctly?";
      const result = chunker.addText(text);
      expect(result).toBe("Is this working correctly?");
    });

    it("respects minChunkSize — does not emit for very short text", () => {
      const result = chunker.addText("Ok.");
      expect(result).toBeNull();
    });

    it("force-emits at maxChunkSize on word boundary", () => {
      const chunkerSmall = new TextChunker({ maxChunkSize: 30 });
      const longText = "word ".repeat(10);
      const result = chunkerSmall.addText(longText);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("string");
      expect(chunkerSmall.getBufferLength()).toBeLessThan(longText.length);
    });

    it("handles multilingual delimiters: 。", () => {
      const smallChunker = new TextChunker({ minChunkSize: 5 });
      const text = "これは日本語の文章です。";
      const result = smallChunker.addText(text);
      expect(result).not.toBeNull();
      expect(result).toContain("。");
    });

    it("handles multilingual delimiters: ！", () => {
      const smallChunker = new TextChunker({ minChunkSize: 5 });
      const text = "これは日本語の文章です！";
      const result = smallChunker.addText(text);
      expect(result).not.toBeNull();
      expect(result).toContain("！");
    });

    it("handles multilingual delimiters: ？", () => {
      const smallChunker = new TextChunker({ minChunkSize: 5 });
      const text = "これは日本語の文章ですか？";
      const result = smallChunker.addText(text);
      expect(result).not.toBeNull();
      expect(result).toContain("？");
    });

    it("handles newlines as delimiters", () => {
      const text = "This is a full line of text\n";
      const result = chunker.addText(text);
      expect(result).not.toBeNull();
    });
  });

  describe("flush", () => {
    it("returns remaining buffer content", () => {
      chunker.addText("leftover text");
      expect(chunker.flush()).toBe("leftover text");
    });

    it("returns null for empty buffer", () => {
      expect(chunker.flush()).toBeNull();
    });

    it("returns null after already flushed", () => {
      chunker.addText("text");
      chunker.flush();
      expect(chunker.flush()).toBeNull();
    });

    it("trims whitespace", () => {
      chunker.addText("  some text  ");
      expect(chunker.flush()).toBe("some text");
    });
  });

  describe("clear", () => {
    it("empties the buffer", () => {
      chunker.addText("some data");
      chunker.clear();
      expect(chunker.getBufferLength()).toBe(0);
    });

    it("flush returns null after clear", () => {
      chunker.addText("data");
      chunker.clear();
      expect(chunker.flush()).toBeNull();
    });
  });

  describe("getBufferLength", () => {
    it("returns 0 for new instance", () => {
      expect(chunker.getBufferLength()).toBe(0);
    });

    it("tracks accumulated text length", () => {
      chunker.addText("hello");
      expect(chunker.getBufferLength()).toBe(5);
    });

    it("decreases after chunk is emitted", () => {
      chunker.addText("This is a test sentence. More text");
      expect(chunker.getBufferLength()).toBeLessThan(
        "This is a test sentence. More text".length,
      );
    });
  });

  describe("multiple addText calls", () => {
    it("accumulates text across calls", () => {
      chunker.addText("Hello ");
      chunker.addText("World");
      expect(chunker.getBufferLength()).toBe(11);
      expect(chunker.flush()).toBe("Hello World");
    });

    it("emits when sentence completes across calls", () => {
      expect(chunker.addText("This is a really")).toBeNull();
      const result = chunker.addText(" great sentence.");
      expect(result).toBe("This is a really great sentence.");
    });
  });

  describe("constructor options", () => {
    it("uses custom minChunkSize", () => {
      const c = new TextChunker({ minChunkSize: 5 });
      expect(c.addText("Hi.")).toBeNull();
      expect(c.addText("Ok ok.")).not.toBeNull();
    });

    it("uses custom maxChunkSize", () => {
      const c = new TextChunker({ maxChunkSize: 20 });
      const result = c.addText("one two three four five six seven");
      expect(result).not.toBeNull();
    });
  });
});
