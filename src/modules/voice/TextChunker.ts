export default class TextChunker {
  chunk(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
}
