export type Point2D = [number, number] | { x: number; y: number };

export interface CephalometricReportJson {
  outline?: Point2D[];
  polylines?: Array<{ points?: Point2D[]; color?: string; label?: string }>;
  outlineColor?: string;
  lineColor?: string;
  conclusion?: string;
  [key: string]: unknown;
}

export interface CephalometricReportResponse {
  caseId?: string;
  patientId?: string | null;
  reportJson?: CephalometricReportJson;
  reportStatus?: string | null;
  metricsJson?: Record<string, unknown>;
  landmarksJson?: Record<string, unknown>;
  createdAt?: string | null;
}

export interface CephalometricCompareCase extends Record<string, unknown> {
  id?: string;
  patientId?: string | null;
  imageUrl?: string | null;
  landmarksJson?: Record<string, unknown>;
  metricsJson?: Record<string, unknown>;
  createdAt?: string | null;
  remark?: string | null;
}

export interface CephalometricCompareResult {
  cases: CephalometricCompareCase[];
}

export interface CephalometricRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  imageUrl?: string | null;
  status?: string | null;
  reportStatus?: string | null;
}

export interface CephalometricForm {
  patientId: string;
  status: string;
  templateId: string;
  landmarksJson: string;
  metricsJson: string;
  remark: string;
  imageUrl: string;
}

export const emptyForm: CephalometricForm = {
  patientId: '',
  status: 'DRAFT',
  templateId: '',
  landmarksJson: '{}',
  metricsJson: '{}',
  remark: '',
  imageUrl: '',
};
