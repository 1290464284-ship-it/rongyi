export const HrConstants = {
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  REJECT_REASON_REQUIRED: 'REJECT_REASON_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  DISABLED: 'DISABLED',
} as const;

export type HrErrorCode = typeof HrConstants[keyof typeof HrConstants];

export const SHIFT_TYPES = {
  MORNING: 'MORNING',
  AFTERNOON: 'AFTERNOON',
  FULL: 'FULL',
  CUSTOM: 'CUSTOM',
  LEAVE: 'LEAVE',
  OFF: 'OFF',
} as const;

export type ShiftType = typeof SHIFT_TYPES[keyof typeof SHIFT_TYPES];

export const LEAVE_TYPES = {
  ANNUAL: 'ANNUAL',
  SICK: 'SICK',
  PERSONAL: 'PERSONAL',
  MARRIAGE: 'MARRIAGE',
  MATERNITY: 'MATERNITY',
  PATERNITY: 'PATERNITY',
  BEREAVEMENT: 'BEREAVEMENT',
  OTHER: 'OTHER',
} as const;

export type LeaveType = typeof LEAVE_TYPES[keyof typeof LEAVE_TYPES];

export const LEAVE_STATUSES = {
  SAVED: 'SAVED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type LeaveStatus = typeof LEAVE_STATUSES[keyof typeof LEAVE_STATUSES];

export const ATTENDANCE_STATUSES = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  OFF: 'OFF',
} as const;

export type AttendanceStatus = typeof ATTENDANCE_STATUSES[keyof typeof ATTENDANCE_STATUSES];

export const DEFAULT_SHIFT_TIMES: Record<string, [string, string]> = {
  MORNING: ['08:00', '12:00'],
  AFTERNOON: ['13:30', '17:30'],
  FULL: ['08:00', '17:30'],
};

export const SETTINGS_KEYS = {
  AI_HR_ENABLED: 'aiHrEnabled',
  AI_HR_DEFAULT_SHIFT_TIMES: 'aiHrDefaultShiftTimes',
};
