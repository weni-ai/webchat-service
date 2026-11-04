/** Drops assistant audio while the shopper is speaking. */
export default class EchoGuard {
  private speaking = false;

  setShopperSpeaking(value: boolean): void {
    this.speaking = value;
  }

  shouldPlay(): boolean {
    return !this.speaking;
  }
}
