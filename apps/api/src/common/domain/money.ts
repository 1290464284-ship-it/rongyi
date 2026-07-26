import { BadRequestException } from '@nestjs/common';

const SCALE = 100;

export class Money {
  private readonly cents: number;

  private constructor(cents: number) {
    this.cents = Math.round(cents);
  }

  static fromYuan(yuan: number): Money {
    if (!Number.isFinite(yuan)) {
      throw new BadRequestException('无效的金额');
    }
    return new Money(yuan * SCALE);
  }

  static fromCents(cents: number): Money {
    return new Money(cents);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  multiply(factor: number): Money {
    return new Money(this.cents * factor);
  }

  divide(divisor: number): Money {
    if (divisor === 0) {
      throw new BadRequestException('不能除以零');
    }
    return new Money(this.cents / divisor);
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.cents >= other.cents;
  }

  lessThan(other: Money): boolean {
    return this.cents < other.cents;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.cents <= other.cents;
  }

  toYuan(): number {
    return this.cents / SCALE;
  }

  toCents(): number {
    return this.cents;
  }

  format(): string {
    return (this.cents / SCALE).toFixed(2);
  }

  toString(): string {
    return `¥${this.format()}`;
  }
}
