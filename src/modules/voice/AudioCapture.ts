export default class AudioCapture {
  static async checkPermission(): Promise<PermissionState | 'unknown'> {
    if (!navigator.mediaDevices?.getUserMedia) return 'unknown';
    try {
      const status = await navigator.permissions?.query({
        name: 'microphone' as PermissionName,
      });
      return status?.state ?? 'prompt';
    } catch {
      return 'prompt';
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }
}
