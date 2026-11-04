export default class SessionGuard {
  private active = false;

  enter(): void {
    this.active = true;
  }

  exit(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
