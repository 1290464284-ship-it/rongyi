/** 按资源 id 粒度的写请求防重守卫（模块级共享，跨行/跨渲染实例生效）。 */
export function createInFlightGuard() {
  const inFlight = new Set<string>();
  return {
    isRunning(id: string): boolean {
      return inFlight.has(id);
    },
    start(id: string): boolean {
      if (inFlight.has(id)) return false;
      inFlight.add(id);
      return true;
    },
    finish(id: string): void {
      inFlight.delete(id);
    },
  };
}
