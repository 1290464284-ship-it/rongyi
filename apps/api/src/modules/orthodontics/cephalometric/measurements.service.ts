 
import { Injectable } from '@nestjs/common';
import { Point2D, Landmarks } from './cephalometric-landmarks';
import {
  ReferencePlanes,
  ReferencePlane,
  calcReferencePlanes,
  euclideanDistance,
  vectorAngleDeg,
  projectToLine,
  projectToLineSigned,
  unitNormal,
} from './reference-planes';

export type SeverityLevel = 0 | 1 | 2 | 3;

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  0: 'NORMAL',
  1: 'MILD',
  2: 'MODERATE',
  3: 'SEVERE',
};

export interface MeasurementValue {
  value: number | null;
  norm: number;
  sd: number;
  delta: number | null;
  severity: SeverityLevel;
  unit: string;
}

export interface MeasurementResult {
  SNA: MeasurementValue;
  SNB: MeasurementValue;
  ANB: MeasurementValue;
  Wits: MeasurementValue;
  'U1-SN': MeasurementValue;
  'L1-MP': MeasurementValue;
  'U1-NA-mm': MeasurementValue;
  'U1-NA-deg': MeasurementValue;
  'L1-NB-mm': MeasurementValue;
  'L1-NB-deg': MeasurementValue;
  'Interincisal Angle': MeasurementValue;
  FMA: MeasurementValue;
  'SN-MP': MeasurementValue;
  'Y-axis': MeasurementValue;
  'PFH/AFH': MeasurementValue;
  'ANS-Me': MeasurementValue;
  'N-ANS': MeasurementValue;
  'S-Go': MeasurementValue;
  Overjet: MeasurementValue;
  Overbite: MeasurementValue;
  'U6-to-Ptv': MeasurementValue;
  'Nasolabial Angle': MeasurementValue;
  'Holdaway angle': MeasurementValue;
}

export interface MeasurementDefinition {
  key: keyof MeasurementResult;
  label: string;
  unit: string;
  norm: number;
  sd: number;
}

export const MEASUREMENT_DEFINITIONS: MeasurementDefinition[] = [
  { key: 'SNA', label: 'SNA 角', unit: '°', norm: 82, sd: 3 },
  { key: 'SNB', label: 'SNB 角', unit: '°', norm: 80, sd: 3 },
  { key: 'ANB', label: 'ANB 角', unit: '°', norm: 2, sd: 2 },
  { key: 'Wits', label: 'Wits 评估值', unit: 'mm', norm: 0, sd: 2 },
  { key: 'U1-SN', label: 'U1-SN 倾斜角', unit: '°', norm: 105, sd: 5 },
  { key: 'L1-MP', label: 'L1-MP 倾斜角', unit: '°', norm: 93, sd: 5 },
  { key: 'U1-NA-mm', label: 'U1-NA 距离', unit: 'mm', norm: 4, sd: 2 },
  { key: 'U1-NA-deg', label: 'U1-NA 角度', unit: '°', norm: 22, sd: 4 },
  { key: 'L1-NB-mm', label: 'L1-NB 距离', unit: 'mm', norm: 4, sd: 2 },
  { key: 'L1-NB-deg', label: 'L1-NB 角度', unit: '°', norm: 25, sd: 4 },
  { key: 'Interincisal Angle', label: '上下中切牙角', unit: '°', norm: 125, sd: 8 },
  { key: 'FMA', label: 'FMA 下颌平面角', unit: '°', norm: 25, sd: 3 },
  { key: 'SN-MP', label: 'SN-MP 平面角', unit: '°', norm: 32, sd: 5 },
  { key: 'Y-axis', label: 'Y 轴角', unit: '°', norm: 66, sd: 4 },
  { key: 'PFH/AFH', label: 'PFH/AFH 比值', unit: '%', norm: 0.65, sd: 0.06 },
  { key: 'ANS-Me', label: 'ANS-Me 前下面高', unit: 'mm', norm: 65, sd: 5 },
  { key: 'N-ANS', label: 'N-ANS 前上面高', unit: 'mm', norm: 55, sd: 4 },
  { key: 'S-Go', label: 'S-Go 后面高', unit: 'mm', norm: 75, sd: 6 },
  { key: 'Overjet', label: '覆盖', unit: 'mm', norm: 2, sd: 1.5 },
  { key: 'Overbite', label: '覆𬌗', unit: 'mm', norm: 2, sd: 1 },
  { key: 'U6-to-Ptv', label: 'U6-Ptv 前后向位置', unit: 'mm', norm: 12, sd: 3 },
  { key: 'Nasolabial Angle', label: '鼻唇角', unit: '°', norm: 90, sd: 10 },
  { key: 'Holdaway angle', label: 'Holdaway 角', unit: '°', norm: 7, sd: 3 },
];

@Injectable()
export class CephalometricMeasurementsService {
  calcLandmarksDerived(landmarks: Landmarks): ReferencePlanes {
    const norm = this.normalizeLandmarks(landmarks);
    return calcReferencePlanes(norm);
  }

  private toSeverity(deltaNum: number | null, sd: number): SeverityLevel {
    if (deltaNum === null) return 0;
    const ratio = Math.abs(deltaNum) / Math.max(sd, 0.0001);
    if (ratio >= 2.5) return 3;
    if (ratio >= 1.5) return 2;
    if (ratio >= 0.5) return 1;
    return 0;
  }

  private static readonly ALIAS_MAP: Record<string, string> = {
    APoint: 'A-point',
    BPoint: 'B-point',
    UI: 'Upper Incisor Edge',
    UIR: 'Upper Incisor Root',
    LI: 'Lower Incisor Edge',
    LIR: 'Lower Incisor Root',
    U6: 'Upper 1st Mesiobuccal',
    L6: 'Lower 1st Mesiobuccal',
    PointW: 'Point W',
    'Upper Mesiobuccal': 'Upper 1st Mesiobuccal',
    'Lower Mesiobuccal': 'Lower 1st Mesiobuccal',
  };

  private normalizeLandmarks(lm: Landmarks): Landmarks {
    if (!lm) return {};
    const out: Landmarks = {};
    for (const key of Object.keys(lm)) {
      const target = CephalometricMeasurementsService.ALIAS_MAP[key] || key;
      out[target] = lm[key];
    }
    return out;
  }

  private makeMeas(def: MeasurementDefinition, value: number | null): MeasurementValue {
    const delta = value === null ? null : value - def.norm;
    return {
      value,
      norm: def.norm,
      sd: def.sd,
      delta,
      severity: this.toSeverity(delta, def.sd),
      unit: def.unit,
    };
  }

  private getP(lm: Landmarks, key: string): Point2D | null {
    const p = lm[key];
    if (!p) return null;
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: p.x, y: p.y };
  }

  private toPxToMm(px: number, scaleFactor: number): number {
    const sf = scaleFactor > 0 ? scaleFactor : 1;
    return px / sf;
  }

  calcAllMeasurements(
    landmarks: Landmarks,
    planesInput: ReferencePlanes | null,
    scaleFactor: number = 1.0,
  ): MeasurementResult {
    const lm = this.normalizeLandmarks(landmarks);
    const planes = planesInput ?? calcReferencePlanes(lm);
    const defMap = new Map(MEASUREMENT_DEFINITIONS.map(d => [d.key, d]));

    const S = this.getP(lm, 'Sella');
    const N = this.getP(lm, 'Nasion');
    const A = this.getP(lm, 'A-point');
    const B = this.getP(lm, 'B-point');
    const _O = this.getP(lm, 'Orbitale');
    const _Pt = this.getP(lm, 'Porion');
    const Me = this.getP(lm, 'Menton');
    const Go = this.getP(lm, 'Gonion');
    const Gn = this.getP(lm, 'Gnathion');
    const Pog = this.getP(lm, 'Pogonion');
    const ANS = this.getP(lm, 'ANS');
    const _PNS = this.getP(lm, 'PNS');
    const UI = this.getP(lm, 'Upper Incisor Edge');
    const UIR = this.getP(lm, 'Upper Incisor Root');
    const LI = this.getP(lm, 'Lower Incisor Edge');
    const LIR = this.getP(lm, 'Lower Incisor Root');
    const U6 = this.getP(lm, 'Upper 1st Mesiobuccal');
    const _L6 = this.getP(lm, 'Lower 1st Mesiobuccal');
    const _Ar = this.getP(lm, 'Articulare');
    const _Ba = this.getP(lm, 'Basion');
    const _Co = this.getP(lm, 'Condylion');
    const Ptm = this.getP(lm, 'Pterygomaxillary');

    // SNA: angle S-N-A
    let SNA_val: number | null = null;
    if (S && N && A) {
      SNA_val = vectorAngleDeg(S, N, A);
    }

    // SNB: angle S-N-B
    let SNB_val: number | null = null;
    if (S && N && B) {
      SNB_val = vectorAngleDeg(S, N, B);
    }

    // ANB = SNA - SNB
    let ANB_val: number | null = null;
    if (SNA_val !== null && SNB_val !== null) {
      ANB_val = SNA_val - SNB_val;
    }

    // Wits: distance between projection of A and B on OP
    let Wits_val: number | null = null;
    if (A && B && planes.OP) {
      const projA = projectToLineSigned(A, planes.OP);
      const projB = projectToLineSigned(B, planes.OP);
      const dx = planes.OP.B.x - planes.OP.A.x;
      const dy = planes.OP.B.y - planes.OP.A.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const unitX = dx / len;
        const unitY = dy / len;
        const coordA = (projA.foot.x - planes.OP.A.x) * unitX + (projA.foot.y - planes.OP.A.y) * unitY;
        const coordB = (projB.foot.x - planes.OP.A.x) * unitX + (projB.foot.y - planes.OP.A.y) * unitY;
        Wits_val = this.toPxToMm(coordA - coordB, scaleFactor);
      }
    }

    // U1-SN: angle between U1 axis and SN
    let U1SN_val: number | null = null;
    if (UIR && UI && planes.SN) {
      const u1Angle = this.lineAngleDeg(UIR, UI, planes.SN.A, planes.SN.B);
      U1SN_val = u1Angle;
    }

    // L1-MP: angle between L1 axis and MP
    let L1MP_val: number | null = null;
    if (LIR && LI && planes.MP) {
      L1MP_val = this.lineAngleDeg(LIR, LI, planes.MP.A, planes.MP.B);
    }

    // U1-NA (mm and deg): distance and angle from U1 edge to NA line
    let U1NAmm_val: number | null = null;
    let U1NAdeg_val: number | null = null;
    if (N && A && UI && UIR) {
      const naLine: ReferencePlane = { A: N, B: A };
      const proj = projectToLine(UI, naLine);
      U1NAmm_val = this.toPxToMm(proj.distance, scaleFactor);
      U1NAdeg_val = this.lineAngleDeg(UIR, UI, N, A);
    }

    // L1-NB (mm and deg): distance and angle from L1 edge to NB line
    let L1NBmm_val: number | null = null;
    let L1NBdeg_val: number | null = null;
    if (N && B && LI && LIR) {
      const nbLine: ReferencePlane = { A: N, B };
      const proj = projectToLine(LI, nbLine);
      L1NBmm_val = this.toPxToMm(proj.distance, scaleFactor);
      L1NBdeg_val = this.lineAngleDeg(LIR, LI, N, B);
    }

    // Interincisal Angle: angle between upper and lower incisor axes
    let interinc_val: number | null = null;
    if (UIR && UI && LIR && LI) {
      interinc_val = this.lineAngleDeg(UIR, UI, LIR, LI);
    }

    // FMA: angle between FH and MP (Frankfort-Mandibular plane angle)
    let FMA_val: number | null = null;
    if (planes.FH && planes.MP) {
      FMA_val = this.lineAngleDeg(planes.FH.A, planes.FH.B, planes.MP.A, planes.MP.B);
    }

    // SN-MP: angle between SN and MP
    let SNMP_val: number | null = null;
    if (planes.SN && planes.MP) {
      SNMP_val = this.lineAngleDeg(planes.SN.A, planes.SN.B, planes.MP.A, planes.MP.B);
    }

    // Y-axis: angle between S-Gn and SN
    let Yaxis_val: number | null = null;
    if (S && Gn && planes.SN) {
      Yaxis_val = this.lineAngleDeg(S, Gn, planes.SN.A, planes.SN.B);
    }

    // PFH/AFH: S-Go / N-Me
    let PFHAFH_val: number | null = null;
    let ANSMe_val: number | null = null;
    let NANS_val: number | null = null;
    let SGo_val: number | null = null;
    if (S && Go) {
      SGo_val = this.toPxToMm(euclideanDistance(S, Go), scaleFactor);
    }
    if (N && Me && ANS) {
      ANSMe_val = this.toPxToMm(euclideanDistance(ANS, Me), scaleFactor);
      NANS_val = this.toPxToMm(euclideanDistance(N, ANS), scaleFactor);
      const AFH = this.toPxToMm(euclideanDistance(N, Me), scaleFactor);
      if (SGo_val !== null && AFH > 0) {
        PFHAFH_val = SGo_val / AFH;
      }
    }

    // Overjet: horizontal distance between UI and LI along OP
    let Overjet_val: number | null = null;
    if (UI && LI && planes.OP) {
      const dx = planes.OP.B.x - planes.OP.A.x;
      const dy = planes.OP.B.y - planes.OP.A.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const unitX = dx / len;
        const unitY = dy / len;
        const projUI = projectToLine(UI, planes.OP);
        const projLI = projectToLine(LI, planes.OP);
        const coordUI = (projUI.foot.x - planes.OP.A.x) * unitX + (projUI.foot.y - planes.OP.A.y) * unitY;
        const coordLI = (projLI.foot.x - planes.OP.A.x) * unitX + (projLI.foot.y - planes.OP.A.y) * unitY;
        Overjet_val = this.toPxToMm(coordUI - coordLI, scaleFactor);
      }
    }

    // Overbite: vertical distance between UI and LI perpendicular to OP
    let Overbite_val: number | null = null;
    if (UI && LI && planes.OP) {
      const n = unitNormal(planes.OP);
      const vx = UI.x - LI.x;
      const vy = UI.y - LI.y;
      const verticalPx = Math.abs(vx * n.nx + vy * n.ny);
      Overbite_val = this.toPxToMm(verticalPx, scaleFactor);
    }

    // U6-to-Ptv: distance from U6 mesiobuccal to Ptv (Ptm perpendicular line to FH)
    let U6Ptv_val: number | null = null;
    if (Ptm && U6 && planes.FH) {
      const ptv: Point2D = { x: Ptm.x, y: Ptm.y };
      const fhDx = planes.FH.B.x - planes.FH.A.x;
      const fhDy = planes.FH.B.y - planes.FH.A.y;
      const fhLen = Math.sqrt(fhDx * fhDx + fhDy * fhDy);
      if (fhLen > 0) {
        const fhNX = -fhDy / fhLen;
        const fhNY = fhDx / fhLen;
        const PtvLine: ReferencePlane = { A: ptv, B: { x: ptv.x + fhNX, y: ptv.y + fhNY } };
        const proj = projectToLine(U6, PtvLine);
        U6Ptv_val = this.toPxToMm(proj.distance, scaleFactor);
      }
    }

    // Nasolabial Angle: angle Subnasale (use ANS approx) - UI tip - Lip (skip without soft tissue)
    let Nasolabial_val: number | null = null;
    if (ANS && UI && Pog) {
      Nasolabial_val = vectorAngleDeg(ANS, UI, Pog);
    }

    // Holdaway angle: angle between Nasion-Pogonion line and L1 tangent
    let Holdaway_val: number | null = null;
    if (N && Pog && LI && LIR) {
      const NP: ReferencePlane = { A: N, B: Pog };
      Holdaway_val = this.lineAngleDeg(NP.A, NP.B, LIR, LI);
      if (Holdaway_val !== null) {
        Holdaway_val = Math.min(Holdaway_val, 180 - Holdaway_val);
      }
    }

    const result: Record<string, MeasurementValue> = {};
    for (const def of MEASUREMENT_DEFINITIONS) {
      let v: number | null = null;
      switch (def.key) {
        case 'SNA': v = SNA_val; break;
        case 'SNB': v = SNB_val; break;
        case 'ANB': v = ANB_val; break;
        case 'Wits': v = Wits_val; break;
        case 'U1-SN': v = U1SN_val; break;
        case 'L1-MP': v = L1MP_val; break;
        case 'U1-NA-mm': v = U1NAmm_val; break;
        case 'U1-NA-deg': v = U1NAdeg_val; break;
        case 'L1-NB-mm': v = L1NBmm_val; break;
        case 'L1-NB-deg': v = L1NBdeg_val; break;
        case 'Interincisal Angle': v = interinc_val; break;
        case 'FMA': v = FMA_val; break;
        case 'SN-MP': v = SNMP_val; break;
        case 'Y-axis': v = Yaxis_val; break;
        case 'PFH/AFH': v = PFHAFH_val; break;
        case 'ANS-Me': v = ANSMe_val; break;
        case 'N-ANS': v = NANS_val; break;
        case 'S-Go': v = SGo_val; break;
        case 'Overjet': v = Overjet_val; break;
        case 'Overbite': v = Overbite_val; break;
        case 'U6-to-Ptv': v = U6Ptv_val; break;
        case 'Nasolabial Angle': v = Nasolabial_val; break;
        case 'Holdaway angle': v = Holdaway_val; break;
      }
      const d = defMap.get(def.key)!;
      result[def.key] = this.makeMeas(d, v);
    }
    return result as unknown as MeasurementResult;
  }

  private lineAngleDeg(p1: Point2D, p2: Point2D, q1: Point2D, q2: Point2D): number | null {
    const v1x = p2.x - p1.x;
    const v1y = p2.y - p1.y;
    const v2x = q2.x - q1.x;
    const v2y = q2.y - q1.y;
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 === 0 || m2 === 0) return null;
    let cosVal = (v1x * v2x + v1y * v2y) / (m1 * m2);
    if (cosVal > 1) cosVal = 1;
    if (cosVal < -1) cosVal = -1;
    return (Math.acos(cosVal) * 180) / Math.PI;
  }
}
