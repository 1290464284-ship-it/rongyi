export interface DailyTaskHandler {
  readonly name: string;
  enabled?: boolean;
  maxRetries?: number;
  execute(clinicId?: string): Promise<void>;
}
