/** Speaks one chunk and resolves when playback ends or throws. */
export default class TTSPlayer {
  async speak(text: string): Promise<void> {
    if (!text.trim()) return;
    const synthesis = window.speechSynthesis;
    if (!synthesis) {
      throw new Error('tts unavailable');
    }
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error('tts failed'));
      synthesis.speak(utterance);
    });
  }

  cancel(): void {
    window.speechSynthesis?.cancel();
  }
}
