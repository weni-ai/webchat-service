export class VoiceError extends Error {
  constructor(
    message: string,
    readonly operation: 'permission' | 'unsupported' | 'stt' | 'tts',
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}
