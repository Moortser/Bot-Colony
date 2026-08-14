export class PointerGestureGuard {
  private readonly activePointers = new Set<number>();
  private gestureActive = false;

  public pointerDown(pointerId: number): void {
    this.activePointers.add(pointerId);
    if (this.activePointers.size >= 2) this.gestureActive = true;
  }

  public markMultiPointerGesture(): void {
    this.gestureActive = true;
  }

  public pointerUp(pointerId: number): boolean {
    const allowWorldClick = !this.gestureActive;
    this.activePointers.delete(pointerId);
    if (this.activePointers.size === 0) this.gestureActive = false;
    return allowWorldClick;
  }
}
