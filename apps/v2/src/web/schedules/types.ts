export interface ShiftTemplate extends Record<string, unknown> {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workDaysJson: string | null;
  workDays?: number[];
  color: string | null;
  active: number;
}

export interface UserRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  username?: string | null;
  role?: string | null;
}

export interface WeekScheduleRow extends Record<string, unknown> {
  id: string;
  userId: string;
  userIdLabel: string;
  title: string | null;
  color: string | null;
  weekDay: number;
  startTime: string;
  endTime: string;
  type: string;
  date: string;
}

export interface GenerateResult {
  created: number;
  skipped: number;
  weekStart: string;
}

export interface TemplateForm {
  name: string;
  startTime: string;
  endTime: string;
  workDays: number[];
  color: string;
  active: boolean;
}
