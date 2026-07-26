import * as crypto from 'node:crypto';

export interface FaultConfig {
  enabled: boolean;
  error?: Error;
  probability?: number;
  delayMs?: number;
  maxTriggers?: number;
}

interface FaultState extends Required<Pick<FaultConfig, 'probability'>> {
  config: FaultConfig;
  triggerCount: number;
}

export class FaultInjector {
  private enabled = false;
  private faults = new Map<string, FaultState>();

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setFault(name: string, config: FaultConfig): void {
    this.faults.set(name, {
      config,
      probability: config.probability ?? 1,
      triggerCount: 0,
    });
  }

  clearFault(name: string): void {
    this.faults.delete(name);
  }

  clearAll(): void {
    this.faults.clear();
  }

  shouldFault(name: string): boolean {
    if (!this.enabled) return false;

    const state = this.faults.get(name);
    if (!state?.config.enabled) return false;

    if (state.config.maxTriggers !== undefined && state.triggerCount >= state.config.maxTriggers) {
      return false;
    }

    if (state.probability < 1) {
      const buffer = crypto.randomBytes(4);
      const randomValue = buffer.readUInt32BE(0) / 0xFFFFFFFF;
      if (randomValue >= state.probability) {
        return false;
      }
    }

    state.triggerCount++;
    return true;
  }

  triggerIfNeeded(name: string): void {
    if (!this.shouldFault(name)) return;

    const state = this.faults.get(name);
    if (!state) return;

    if (state.config.delayMs && state.config.delayMs > 0) {
      const start = Date.now();
      while (Date.now() - start < state.config.delayMs) {
        // 同步延迟，用于测试慢操作
      }
    }

    if (state.config.error) {
      throw state.config.error;
    }
  }

  getTriggerCount(name: string): number {
    return this.faults.get(name)?.triggerCount ?? 0;
  }

  reset(): void {
    this.faults.clear();
    this.enabled = false;
  }
}

export const faultInjector = new FaultInjector();

export function createDbBusyFault(): FaultConfig {
  return {
    enabled: true,
    error: new Error('SQLITE_BUSY: database is locked'),
    probability: 1,
  };
}

export function createDbLockedFault(): FaultConfig {
  return {
    enabled: true,
    error: new Error('SQLITE_LOCKED: database table is locked'),
    probability: 1,
  };
}

export function createNetworkTimeoutFault(): FaultConfig {
  return {
    enabled: true,
    error: new Error('Network timeout'),
    delayMs: 5000,
    probability: 1,
  };
}

export function createRandomFailureFault(probability: number): FaultConfig {
  return {
    enabled: true,
    error: new Error('Random failure'),
    probability,
  };
}
