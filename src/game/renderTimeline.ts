export class RenderTimeline {
  private simulationRevision = -1;
  private lastRenderAt = -1;

  public isStale(simulationRevision: number): boolean {
    return simulationRevision !== this.simulationRevision;
  }

  public shouldRender(gameTime: number, speed: number, simulationRevision: number): boolean {
    if (simulationRevision !== this.simulationRevision) {
      this.simulationRevision = simulationRevision;
      this.lastRenderAt = gameTime;
      return true;
    }
    if (speed === 0 || gameTime - this.lastRenderAt >= 0.05) {
      this.lastRenderAt = gameTime;
      return true;
    }
    return false;
  }
}
