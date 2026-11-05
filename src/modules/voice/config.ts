const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export const VALID_TTS_MODELS = ['eleven_flash_v2_5', 'eleven_multilingual_v2'];

const VALID_AUDIO_FORMATS = ['mp3_44100_128', 'pcm_24000'];

export const DEFAULT_VOICE_CONFIG = {
  voiceId: DEFAULT_VOICE_ID,
  ttsModel: 'eleven_flash_v2_5',
  audioFormat: 'mp3_44100_128',
  languageCode: 'en',
  sttUrl: '',
  maxReconnectAttempts: 5,
};

export interface TtsSettings {
  voiceId: string;
  ttsModel: string;
  audioFormat: string;
  languageCode: string;
}

interface VoiceModeConfig {
  elevenLabs?: { voiceId?: string };
  ttsModel?: string;
  audioFormat?: string;
  languageCode?: string;
}

export function resolveTtsSettings(voiceMode?: VoiceModeConfig): TtsSettings {
  const ttsModel = voiceMode?.ttsModel || DEFAULT_VOICE_CONFIG.ttsModel;
  const audioFormat =
    voiceMode?.audioFormat || DEFAULT_VOICE_CONFIG.audioFormat;
  if (!VALID_TTS_MODELS.includes(ttsModel)) {
    throw new Error(`ttsModel must be one of: ${VALID_TTS_MODELS.join(', ')}`);
  }
  if (!VALID_AUDIO_FORMATS.includes(audioFormat)) {
    throw new Error(
      `audioFormat must be one of: ${VALID_AUDIO_FORMATS.join(', ')}`,
    );
  }
  const languageCode = (
    voiceMode?.languageCode || DEFAULT_VOICE_CONFIG.languageCode
  )
    .split('-')[0]
    .toLowerCase();
  return {
    voiceId: voiceMode?.elevenLabs?.voiceId || DEFAULT_VOICE_ID,
    ttsModel,
    audioFormat,
    languageCode,
  };
}

/** ElevenLabs streaming TTS URL. The token is single-use; the API key stays on the server. */
export function buildTTSWebSocketURL(
  voiceId: string,
  settings: TtsSettings,
  token: string,
): string {
  const base = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input`;
  const params = new URLSearchParams();
  params.set('single_use_token', token);
  params.set('model_id', settings.ttsModel);
  params.set('output_format', settings.audioFormat);
  params.set('inactivity_timeout', '120');
  if (settings.languageCode) {
    params.set('language_code', settings.languageCode);
  }
  return `${base}?${params.toString()}`;
}
