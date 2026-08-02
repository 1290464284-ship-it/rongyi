export const ALERT_SETTINGS_KEYS = {
  REVENUE_DROP_WARN: 'aiAlertRevenueDropWarn',
  REVENUE_DROP_CRITICAL: 'aiAlertRevenueDropCritical',
  NO_SHOW_WARN: 'aiAlertNoShowWarn',
  NO_SHOW_CRITICAL: 'aiAlertNoShowCritical',
  NEW_PATIENTS_WARN: 'aiAlertNewPatientsWarn',
  NEW_PATIENTS_CRITICAL: 'aiAlertNewPatientsCritical',
  AOV_WARN: 'aiAlertAovWarn',
  AOV_CRITICAL: 'aiAlertAovCritical',
  DOCTOR_PERF_Z_WARN: 'aiAlertDoctorPerfZWarn',
  DOCTOR_PERF_Z_CRITICAL: 'aiAlertDoctorPerfZCritical',
} as const;

export type AlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type AlertType =
  | 'REVENUE_DROP'
  | 'NEW_PATIENTS'
  | 'NO_SHOW_RATE'
  | 'AOV'
  | 'PERFORMANCE_ANOMALY';

export const DEFAULT_THRESHOLDS: Record<string, { warn: number; critical: number }> = {
  REVENUE_DROP: { warn: 20, critical: 35 },
  NEW_PATIENTS: { warn: 20, critical: 35 },
  NO_SHOW_RATE: { warn: 15, critical: 25 },
  AOV: { warn: 15, critical: 30 },
  DOCTOR_PERF_Z: { warn: 3, critical: 5 },
};

export interface FindingItem {
  alertType: AlertType;
  severity: AlertSeverity;
  metricName: string;
  currentValue: number;
  baselineValue: number;
  deviationPercent: number;
  message: string;
  suggestion: string;
  occurredAt: string;
}

export function classifySeverity(
  deviationAbs: number,
  warn: number,
  critical: number,
): AlertSeverity {
  if (deviationAbs >= critical) return 'CRITICAL';
  if (deviationAbs >= warn) return 'WARN';
  return 'INFO';
}
