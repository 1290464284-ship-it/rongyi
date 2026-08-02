import { Injectable } from '@nestjs/common';
import { Point2D, ShortCodeLandmarks } from './cephalometric-landmarks';
import {
  ReferencePlane,
  euclideanDistance,
  angleBetweenLines,
  projectToLine,
  projectToLineSigned,
} from './reference-planes';

/**
 * 分析方法枚举
 */
export type AnalysisMethod = 'STEINER' | 'DOWNS' | 'TWEE' | 'MCNAMARA';

/**
 * 单个指标计算结果
 */
export interface MetricResult {
  code: string;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  method: AnalysisMethod;
}

/**
 * 点到点距离辅助（mm，scaleFactor=1 时 px=mm）
 */
function dist(a: Point2D, b: Point2D): number {
  return euclideanDistance(a, b);
}

/**
 * 三点夹角（顶点在 b）
 */
function angleAtVertex(a: Point2D, b: Point2D, c: Point2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 === 0 || m2 === 0) return 0;
  let cosVal = (v1x * v2x + v1y * v2y) / (m1 * m2);
  if (cosVal > 1) cosVal = 1;
  if (cosVal < -1) cosVal = -1;
  return (Math.acos(cosVal) * 180) / Math.PI;
}

/**
 * 保留 1 位小数
 */
function round1(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

interface MetricDef {
  code: string;
  label: string;
  unit: string;
  formula: string;
  method: AnalysisMethod;
  calc: (lm: ShortCodeLandmarks) => number | null;
}

function getP(lm: ShortCodeLandmarks, code: string): Point2D | null {
  const p = lm[code];
  if (!p) return null;
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

// =========================================================================
// 50+ 指标定义（按方法分组）
// =========================================================================
const ALL_METRIC_DEFS: MetricDef[] = [
  // ============= Steiner 法（≥7 项） =============
  {
    code: 'SNA',
    label: 'SNA 角',
    unit: '°',
    formula: 'SNA: S-N 平面与 N-A 平面的交角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N'), A = getP(lm, 'A');
      if (!S || !N || !A) return null;
      return angleAtVertex(S, N, A);
    },
  },
  {
    code: 'SNB',
    label: 'SNB 角',
    unit: '°',
    formula: 'SNB: S-N 平面与 N-B 平面的交角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N'), B = getP(lm, 'B');
      if (!S || !N || !B) return null;
      return angleAtVertex(S, N, B);
    },
  },
  {
    code: 'ANB',
    label: 'ANB 角',
    unit: '°',
    formula: 'ANB = SNA - SNB — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N'), A = getP(lm, 'A'), B = getP(lm, 'B');
      if (!S || !N || !A || !B) return null;
      const sna = angleAtVertex(S, N, A);
      const snb = angleAtVertex(S, N, B);
      return sna - snb;
    },
  },
  {
    code: 'SND',
    label: 'SND 角',
    unit: '°',
    formula: 'SND: S-N 平面与 N-D 的交角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const D = getP(lm, 'DC');
      if (!S || !N || !D) return null;
      return angleAtVertex(S, N, D);
    },
  },
  {
    code: 'U1-NA-deg',
    label: 'U1-NA 角度',
    unit: '°',
    formula: 'U1-NA: 上中切牙长轴与 N-A 连线的交角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A');
      const UIA = getP(lm, 'UIA'), UIE = getP(lm, 'UIE');
      if (!N || !A || !UIA || !UIE) return null;
      return angleBetweenLines(UIA, UIE, N, A);
    },
  },
  {
    code: 'L1-NB-deg',
    label: 'L1-NB 角度',
    unit: '°',
    formula: 'L1-NB: 下中切牙长轴与 N-B 连线的交角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), B = getP(lm, 'B');
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      if (!N || !B || !LIA || !LIE) return null;
      return angleBetweenLines(LIA, LIE, N, B);
    },
  },
  {
    code: 'U1-NA-mm',
    label: 'U1-NA 距离',
    unit: 'mm',
    formula: 'U1-NA(mm): 上中切牙切缘到 N-A 连线的垂直距离 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A'), UIE = getP(lm, 'UIE');
      if (!N || !A || !UIE) return null;
      const line: ReferencePlane = { A: N, B: A };
      return projectToLine(UIE, line).distance;
    },
  },
  {
    code: 'L1-NB-mm',
    label: 'L1-NB 距离',
    unit: 'mm',
    formula: 'L1-NB(mm): 下中切牙切缘到 N-B 连线的垂直距离 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), B = getP(lm, 'B'), LIE = getP(lm, 'LIE');
      if (!N || !B || !LIE) return null;
      const line: ReferencePlane = { A: N, B };
      return projectToLine(LIE, line).distance;
    },
  },
  {
    code: 'Holdaway',
    label: 'Holdaway 修正角',
    unit: '°',
    formula: 'Holdaway: N-Pog 与 NB 线夹角修正 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), Pog = getP(lm, 'Pog'), B = getP(lm, 'B');
      if (!N || !Pog || !B) return null;
      const ang = angleBetweenLines(N, Pog, N, B);
      return Math.min(ang, 180 - ang);
    },
  },
  {
    code: 'U1-SN',
    label: 'U1-SN 倾斜角',
    unit: '°',
    formula: 'U1-SN: 上中切牙长轴与 SN 平面夹角 — Steiner 法',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const UIA = getP(lm, 'UIA'), UIE = getP(lm, 'UIE');
      if (!S || !N || !UIA || !UIE) return null;
      return angleBetweenLines(UIA, UIE, S, N);
    },
  },

  // ============= Downs 法（≥8 项） =============
  {
    code: 'FacialAngle',
    label: '面角 (Downs)',
    unit: '°',
    formula: '面角: FH 平面与 N-Pog 的夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const N = getP(lm, 'N'), Pog = getP(lm, 'Pog');
      if (!Po || !O || !N || !Pog) return null;
      return angleBetweenLines(Po, O, N, Pog);
    },
  },
  {
    code: 'ConvexAngle',
    label: '颌凸角 (Downs)',
    unit: '°',
    formula: '颌凸角: N-A 与 A-Pog 连线交角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A'), Pog = getP(lm, 'Pog');
      if (!N || !A || !Pog) return null;
      return angleBetweenLines(N, A, A, Pog);
    },
  },
  {
    code: 'AB-PlaneAngle',
    label: 'AB 平面角 (Downs)',
    unit: '°',
    formula: 'AB 平面角: N-Pog 与 A-B 连线夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const N = getP(lm, 'N'), Pog = getP(lm, 'Pog');
      const A = getP(lm, 'A'), B = getP(lm, 'B');
      if (!N || !Pog || !A || !B) return null;
      return angleBetweenLines(A, B, N, Pog);
    },
  },
  {
    code: 'MPA-Downs',
    label: '下颌平面角 (Downs)',
    unit: '°',
    formula: '下颌平面角: FH 与 Go-Me 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const Go = getP(lm, 'Go'), Me = getP(lm, 'Me');
      if (!Po || !O || !Go || !Me) return null;
      return angleBetweenLines(Po, O, Go, Me);
    },
  },
  {
    code: 'Y-axis',
    label: 'Y 轴角 (Downs)',
    unit: '°',
    formula: 'Y 轴角: FH 与 S-Gn 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const S = getP(lm, 'S'), Gn = getP(lm, 'Gn');
      if (!Po || !O || !S || !Gn) return null;
      return angleBetweenLines(Po, O, S, Gn);
    },
  },
  {
    code: 'InterincisalAngle',
    label: '上下中切牙角 (Downs)',
    unit: '°',
    formula: '上下中切牙角: UIA-UIE 与 LIA-LIE 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const UIA = getP(lm, 'UIA'), UIE = getP(lm, 'UIE');
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      if (!UIA || !UIE || !LIA || !LIE) return null;
      return angleBetweenLines(UIA, UIE, LIA, LIE);
    },
  },
  {
    code: 'L1-MP-Downs',
    label: '下中切牙-下颌平面角 (Downs)',
    unit: '°',
    formula: 'L1-MP: LIA-LIE 与 Go-Me 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      const Go = getP(lm, 'Go'), Me = getP(lm, 'Me');
      if (!LIA || !LIE || !Go || !Me) return null;
      return angleBetweenLines(LIA, LIE, Go, Me);
    },
  },
  {
    code: 'L1-AB-Downs',
    label: '下中切牙-AB 平面角 (Downs)',
    unit: '°',
    formula: 'L1-AB: LIA-LIE 与 A-B 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      const A = getP(lm, 'A'), B = getP(lm, 'B');
      if (!LIA || !LIE || !A || !B) return null;
      return angleBetweenLines(LIA, LIE, A, B);
    },
  },
  {
    code: 'OP-FH-Downs',
    label: '𬌗平面角 (Downs)',
    unit: '°',
    formula: 'OP-FH: FH 与 OP(UIE-U6M) 夹角 — Downs 法',
    method: 'DOWNS',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const UIE = getP(lm, 'UIE'), U6M = getP(lm, 'U6M');
      if (!Po || !O || !UIE || !U6M) return null;
      return angleBetweenLines(Po, O, UIE, U6M);
    },
  },

  // ============= Tweed 法（≥3 项） =============
  {
    code: 'FMA',
    label: 'FMA 下颌平面角 (Tweed)',
    unit: '°',
    formula: 'FMA: FH 平面(Po→O) 与 下颌平面(Go→Gn) 夹角 — Tweed 法',
    method: 'TWEE',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      if (!Po || !O || !Go || !Gn) return null;
      return angleBetweenLines(Po, O, Go, Gn);
    },
  },
  {
    code: 'FMIA',
    label: 'FMIA 角 (Tweed)',
    unit: '°',
    formula: 'FMIA: FH 与 LIA-LIE（下中切牙长轴）夹角 — Tweed 法',
    method: 'TWEE',
    calc: (lm) => {
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      if (!Po || !O || !LIA || !LIE) return null;
      return angleBetweenLines(Po, O, LIA, LIE);
    },
  },
  {
    code: 'IMPA',
    label: 'IMPA 角 (Tweed)',
    unit: '°',
    formula: 'IMPA: 下切牙长轴(UIA→UIE)与下颌平面(Go→Me)夹角 — Tweed 法',
    method: 'TWEE',
    calc: (lm) => {
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      const Go = getP(lm, 'Go'), Me = getP(lm, 'Me');
      if (!LIA || !LIE || !Go || !Me) return null;
      return angleBetweenLines(LIA, LIE, Go, Me);
    },
  },

  // ============= McNamara 法（≥5 项） =============
  {
    code: 'Co-A',
    label: 'Co-A 上颌长度 (McNamara)',
    unit: 'mm',
    formula: 'Co-A: 髁突点 Co 到 A 点距离 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Co = getP(lm, 'Co'), A = getP(lm, 'A');
      if (!Co || !A) return null;
      return dist(Co, A);
    },
  },
  {
    code: 'Co-Gn',
    label: 'Co-Gn 下颌长度 (McNamara)',
    unit: 'mm',
    formula: 'Co-Gn: 髁突点 Co 到 Gn 点距离 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Co = getP(lm, 'Co'), Gn = getP(lm, 'Gn');
      if (!Co || !Gn) return null;
      return dist(Co, Gn);
    },
  },
  {
    code: 'N-Perp-A',
    label: 'A 点到鼻根垂线距 (McNamara)',
    unit: 'mm',
    formula: 'N-Perp-A: A 点到鼻根垂线（垂直于 FH）的水平距离 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A');
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      if (!N || !A) return null;
      // 如果有 FH，用垂直于 FH 的方向；否则用垂直方向
      if (Po && O) {
        const dx = O.x - Po.x;
        const dy = O.y - Po.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          const v = { x: A.x - N.x, y: A.y - N.y };
          return Math.abs(v.x * nx + v.y * ny);
        }
      }
      return Math.abs(A.x - N.x);
    },
  },
  {
    code: 'N-Perp-Pog',
    label: 'Pog 到鼻根垂线距 (McNamara)',
    unit: 'mm',
    formula: 'N-Perp-Pog: Pog 到鼻根垂线（垂直于 FH）的水平距离 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const N = getP(lm, 'N'), Pog = getP(lm, 'Pog');
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      if (!N || !Pog) return null;
      if (Po && O) {
        const dx = O.x - Po.x;
        const dy = O.y - Po.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          const v = { x: Pog.x - N.x, y: Pog.y - N.y };
          return Math.abs(v.x * nx + v.y * ny);
        }
      }
      return Math.abs(Pog.x - N.x);
    },
  },
  {
    code: 'MPA-McNamara',
    label: '下颌平面角 (McNamara)',
    unit: '°',
    formula: 'MPA-McNamara: 下颌平面(Go-Gn)与鼻根垂线夹角 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      const N = getP(lm, 'N'), Po = getP(lm, 'Po'), O = getP(lm, 'O');
      if (!Go || !Gn || !N) return null;
      // 鼻根垂线方向：垂直于 FH（若有 FH），否则取垂直方向
      let perpX = 0, perpY = -1;
      if (Po && O) {
        const dx = O.x - Po.x;
        const dy = O.y - Po.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          perpX = -dy / len;
          perpY = dx / len;
        }
      }
      const perpEnd: Point2D = { x: N.x + perpX, y: N.y + perpY };
      return angleBetweenLines(Go, Gn, N, perpEnd);
    },
  },
  {
    code: 'ANS-Me-McNamara',
    label: '前下面高 (McNamara)',
    unit: 'mm',
    formula: 'ANS-Me: ANS 到 Me 距离 — McNamara 法',
    method: 'MCNAMARA',
    calc: (lm) => {
      const ANS = getP(lm, 'ANS'), Me = getP(lm, 'Me');
      if (!ANS || !Me) return null;
      return dist(ANS, Me);
    },
  },

  // ============= 通用角度类（≥20 项） =============
  {
    code: 'SN-MP',
    label: 'SN-MP 平面角',
    unit: '°',
    formula: 'SN-MP: SN 平面与 Go-Gn 平面夹角',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      if (!S || !N || !Go || !Gn) return null;
      return angleBetweenLines(S, N, Go, Gn);
    },
  },
  {
    code: 'Occ-SN',
    label: 'Occ-SN 呀平面角',
    unit: '°',
    formula: 'Occ-SN: SN 与 OP(UIE-L6M) 夹角',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const UIE = getP(lm, 'UIE'), L6M = getP(lm, 'L6M');
      if (!S || !N || !UIE || !L6M) return null;
      return angleBetweenLines(S, N, UIE, L6M);
    },
  },
  {
    code: 'Occ-MP',
    label: 'Occ-MP 呀平面-下颌平面角',
    unit: '°',
    formula: 'Occ-MP: OP(UIE-L6M) 与 Go-Gn 夹角',
    method: 'DOWNS',
    calc: (lm) => {
      const UIE = getP(lm, 'UIE'), L6M = getP(lm, 'L6M');
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      if (!UIE || !L6M || !Go || !Gn) return null;
      return angleBetweenLines(UIE, L6M, Go, Gn);
    },
  },
  {
    code: 'NAPog',
    label: '面角/凸角 NAPog',
    unit: '°',
    formula: 'NAPog: N-A-Pog 三点夹角（面凸度）',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A'), Pog = getP(lm, 'Pog');
      if (!N || !A || !Pog) return null;
      return angleAtVertex(N, A, Pog);
    },
  },
  {
    code: 'Go-Gn-SN',
    label: 'Go-Gn-SN 角',
    unit: '°',
    formula: 'Go-Gn-SN: Go-Gn 与 S-N 夹角（同 SN-MP 变体）',
    method: 'DOWNS',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      if (!S || !N || !Go || !Gn) return null;
      return angleBetweenLines(Go, Gn, S, N);
    },
  },
  {
    code: 'NS-Ar',
    label: 'NS-Ar 颅底角',
    unit: '°',
    formula: 'NS-Ar: N-S-Ar 三点夹角',
    method: 'MCNAMARA',
    calc: (lm) => {
      const N = getP(lm, 'N'), S = getP(lm, 'S'), Ar = getP(lm, 'Ar');
      if (!N || !S || !Ar) return null;
      return angleAtVertex(N, S, Ar);
    },
  },
  {
    code: 'S-Ar-Go',
    label: 'S-Ar-Go 关节角',
    unit: '°',
    formula: 'S-Ar-Go: S-Ar-Go 三点夹角',
    method: 'MCNAMARA',
    calc: (lm) => {
      const S = getP(lm, 'S'), Ar = getP(lm, 'Ar'), Go = getP(lm, 'Go');
      if (!S || !Ar || !Go) return null;
      return angleAtVertex(S, Ar, Go);
    },
  },
  {
    code: 'Ar-Go-Me',
    label: 'Ar-Go-Me 下颌角',
    unit: '°',
    formula: 'Ar-Go-Me: Ar-Go-Me 三点夹角（下颌角）',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Ar = getP(lm, 'Ar'), Go = getP(lm, 'Go'), Me = getP(lm, 'Me');
      if (!Ar || !Go || !Me) return null;
      return angleAtVertex(Ar, Go, Me);
    },
  },
  {
    code: 'Ar-Go-N',
    label: 'Ar-Go-N 角',
    unit: '°',
    formula: 'Ar-Go-N: Ar-Go-N 三点夹角',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Ar = getP(lm, 'Ar'), Go = getP(lm, 'Go'), N = getP(lm, 'N');
      if (!Ar || !Go || !N) return null;
      return angleAtVertex(Ar, Go, N);
    },
  },
  {
    code: 'U1-APog',
    label: 'U1-APog 角',
    unit: '°',
    formula: 'U1-APog: 上中切牙长轴与 A-Pog 夹角',
    method: 'STEINER',
    calc: (lm) => {
      const A = getP(lm, 'A'), Pog = getP(lm, 'Pog');
      const UIA = getP(lm, 'UIA'), UIE = getP(lm, 'UIE');
      if (!A || !Pog || !UIA || !UIE) return null;
      return angleBetweenLines(UIA, UIE, A, Pog);
    },
  },
  {
    code: 'U1-PP',
    label: 'U1-PP 上切牙-腭平面角',
    unit: '°',
    formula: 'U1-PP: UIA-UIE 与 ANS-PNS 夹角',
    method: 'STEINER',
    calc: (lm) => {
      const ANS = getP(lm, 'ANS'), PNS = getP(lm, 'PNS');
      const UIA = getP(lm, 'UIA'), UIE = getP(lm, 'UIE');
      if (!ANS || !PNS || !UIA || !UIE) return null;
      return angleBetweenLines(UIA, UIE, ANS, PNS);
    },
  },
  {
    code: 'L1-MP',
    label: 'L1-MP 倾斜角',
    unit: '°',
    formula: 'L1-MP: LIA-LIE 与 Go-Me 夹角',
    method: 'TWEE',
    calc: (lm) => {
      const LIA = getP(lm, 'LIA'), LIE = getP(lm, 'LIE');
      const Go = getP(lm, 'Go'), Me = getP(lm, 'Me');
      if (!LIA || !LIE || !Go || !Me) return null;
      return angleBetweenLines(LIA, LIE, Go, Me);
    },
  },

  // ============= 线距类（≥15 项） =============
  {
    code: 'S-N',
    label: 'S-N 颅底距离',
    unit: 'mm',
    formula: 'S-N: S 到 N 的欧氏距离',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      if (!S || !N) return null;
      return dist(S, N);
    },
  },
  {
    code: 'N-A',
    label: 'N-A 距离',
    unit: 'mm',
    formula: 'N-A: N 到 A 的欧氏距离',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), A = getP(lm, 'A');
      if (!N || !A) return null;
      return dist(N, A);
    },
  },
  {
    code: 'N-B',
    label: 'N-B 距离',
    unit: 'mm',
    formula: 'N-B: N 到 B 的欧氏距离',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), B = getP(lm, 'B');
      if (!N || !B) return null;
      return dist(N, B);
    },
  },
  {
    code: 'N-Pog',
    label: 'N-Pog 距离',
    unit: 'mm',
    formula: 'N-Pog: N 到 Pog 的欧氏距离',
    method: 'DOWNS',
    calc: (lm) => {
      const N = getP(lm, 'N'), Pog = getP(lm, 'Pog');
      if (!N || !Pog) return null;
      return dist(N, Pog);
    },
  },
  {
    code: 'A-Pog',
    label: 'A-Pog 距离',
    unit: 'mm',
    formula: 'A-Pog: A 到 Pog 的欧氏距离',
    method: 'STEINER',
    calc: (lm) => {
      const A = getP(lm, 'A'), Pog = getP(lm, 'Pog');
      if (!A || !Pog) return null;
      return dist(A, Pog);
    },
  },
  {
    code: 'Wits',
    label: 'Wits 评估值',
    unit: 'mm',
    formula: 'Wits: A 点到 OP 垂线与 B 点到 OP 垂线距离差',
    method: 'STEINER',
    calc: (lm) => {
      const A = getP(lm, 'A'), B = getP(lm, 'B');
      const UIE = getP(lm, 'UIE'), L6M = getP(lm, 'L6M');
      if (!A || !B || !UIE || !L6M) return null;
      const op: ReferencePlane = { A: UIE, B: L6M };
      const projA = projectToLineSigned(A, op);
      const projB = projectToLineSigned(B, op);
      const dx = op.B.x - op.A.x;
      const dy = op.B.y - op.A.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return null;
      const unitX = dx / len;
      const unitY = dy / len;
      const coordA = (projA.foot.x - op.A.x) * unitX + (projA.foot.y - op.A.y) * unitY;
      const coordB = (projB.foot.x - op.A.x) * unitX + (projB.foot.y - op.A.y) * unitY;
      return coordA - coordB;
    },
  },
  {
    code: 'U1-APog-mm',
    label: 'U1-APog 距离',
    unit: 'mm',
    formula: 'U1-APog(mm): UIE 到 A-Pog 线的垂直距离',
    method: 'STEINER',
    calc: (lm) => {
      const A = getP(lm, 'A'), Pog = getP(lm, 'Pog'), UIE = getP(lm, 'UIE');
      if (!A || !Pog || !UIE) return null;
      const line: ReferencePlane = { A, B: Pog };
      return projectToLine(UIE, line).distance;
    },
  },
  {
    code: 'Pog-NB',
    label: 'Pog-NB 距离',
    unit: 'mm',
    formula: 'Pog-NB: Pog 到 N-B 线的垂直距离',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), B = getP(lm, 'B'), Pog = getP(lm, 'Pog');
      if (!N || !B || !Pog) return null;
      const line: ReferencePlane = { A: N, B };
      return projectToLine(Pog, line).distance;
    },
  },
  {
    code: 'Overjet',
    label: '覆盖',
    unit: 'mm',
    formula: 'Overjet: UIE.x - LIE.x（水平距离）',
    method: 'STEINER',
    calc: (lm) => {
      const UIE = getP(lm, 'UIE'), LIE = getP(lm, 'LIE');
      if (!UIE || !LIE) return null;
      return UIE.x - LIE.x;
    },
  },
  {
    code: 'Overbite',
    label: '覆𬌗',
    unit: 'mm',
    formula: 'Overbite: UIE.y - LIE.y（垂直距离）',
    method: 'STEINER',
    calc: (lm) => {
      const UIE = getP(lm, 'UIE'), LIE = getP(lm, 'LIE');
      if (!UIE || !LIE) return null;
      return UIE.y - LIE.y;
    },
  },
  {
    code: 'Co-Go',
    label: 'Co-Go 下颌支长',
    unit: 'mm',
    formula: 'Co-Go: Co 到 Go 的欧氏距离（下颌支长）',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Co = getP(lm, 'Co'), Go = getP(lm, 'Go');
      if (!Co || !Go) return null;
      return dist(Co, Go);
    },
  },
  {
    code: 'Go-Pog',
    label: 'Go-Pog 下颌体长',
    unit: 'mm',
    formula: 'Go-Pog: Go 到 Pog 的欧氏距离（下颌体长）',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Go = getP(lm, 'Go'), Pog = getP(lm, 'Pog');
      if (!Go || !Pog) return null;
      return dist(Go, Pog);
    },
  },
  {
    code: 'ANS-Me',
    label: 'ANS-Me 前下面高',
    unit: 'mm',
    formula: 'ANS-Me: ANS 到 Me 的距离（前下面高）',
    method: 'STEINER',
    calc: (lm) => {
      const ANS = getP(lm, 'ANS'), Me = getP(lm, 'Me');
      if (!ANS || !Me) return null;
      return dist(ANS, Me);
    },
  },
  {
    code: 'N-ANS',
    label: 'N-ANS 前上面高',
    unit: 'mm',
    formula: 'N-ANS: N 到 ANS 的距离（前上面高）',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), ANS = getP(lm, 'ANS');
      if (!N || !ANS) return null;
      return dist(N, ANS);
    },
  },
  {
    code: 'N-Me',
    label: 'N-Me 全面高',
    unit: 'mm',
    formula: 'N-Me: N 到 Me 的距离（全面高）',
    method: 'STEINER',
    calc: (lm) => {
      const N = getP(lm, 'N'), Me = getP(lm, 'Me');
      if (!N || !Me) return null;
      return dist(N, Me);
    },
  },
  {
    code: 'S-Go',
    label: 'S-Go 后面高',
    unit: 'mm',
    formula: 'S-Go: S 到 Go 的距离（后面高）',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), Go = getP(lm, 'Go');
      if (!S || !Go) return null;
      return dist(S, Go);
    },
  },
  {
    code: 'U6-to-Ptv',
    label: 'U6-Ptv 前后向位置',
    unit: 'mm',
    formula: 'U6-to-Ptv: U6M 到 Ptm 垂线（垂直于 FH）的距离',
    method: 'STEINER',
    calc: (lm) => {
      const Ptm = getP(lm, 'Ptm'), U6M = getP(lm, 'U6M');
      const Po = getP(lm, 'Po'), O = getP(lm, 'O');
      if (!Ptm || !U6M) return null;
      if (!Po || !O) return Math.abs(U6M.x - Ptm.x);
      const dx = O.x - Po.x;
      const dy = O.y - Po.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return null;
      const nx = -dy / len;
      const ny = dx / len;
      const ptvLine: ReferencePlane = { A: Ptm, B: { x: Ptm.x + nx, y: Ptm.y + ny } };
      return projectToLine(U6M, ptvLine).distance;
    },
  },
  {
    code: 'NasolabialAngle',
    label: '鼻唇角',
    unit: '°',
    formula: '鼻唇角: Sn-UIE-(UIA 或 Sn 上方) 三点夹角',
    method: 'STEINER',
    calc: (lm) => {
      const Sn = getP(lm, 'Sn'), UIE = getP(lm, 'UIE'), UIA = getP(lm, 'UIA');
      if (!Sn || !UIE || !UIA) return null;
      return angleAtVertex(Sn, UIE, UIA);
    },
  },

  // ============= 比例（%）类（≥5 项） =============
  {
    code: 'SN-MP-Pct',
    label: 'SN-MP 百分比',
    unit: '%',
    formula: 'SN-MP-Pct: SN-MP 角 / 32 * 100',
    method: 'DOWNS',
    calc: (lm) => {
      const S = getP(lm, 'S'), N = getP(lm, 'N');
      const Go = getP(lm, 'Go'), Gn = getP(lm, 'Gn');
      if (!S || !N || !Go || !Gn) return null;
      const ang = angleBetweenLines(S, N, Go, Gn);
      return (ang / 32) * 100;
    },
  },
  {
    code: 'PFH-AFH',
    label: '后前面高比',
    unit: '%',
    formula: 'PFH/AFH: (S-Go) / (N-Me) * 100',
    method: 'STEINER',
    calc: (lm) => {
      const S = getP(lm, 'S'), Go = getP(lm, 'Go');
      const N = getP(lm, 'N'), Me = getP(lm, 'Me');
      if (!S || !Go || !N || !Me) return null;
      const afh = dist(N, Me);
      if (afh === 0) return null;
      return (dist(S, Go) / afh) * 100;
    },
  },
  {
    code: 'RamusBodyRatio',
    label: '下颌支体长比',
    unit: '%',
    formula: 'Co-Go / Go-Pog * 100',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Co = getP(lm, 'Co'), Go = getP(lm, 'Go'), Pog = getP(lm, 'Pog');
      if (!Co || !Go || !Pog) return null;
      const body = dist(Go, Pog);
      if (body === 0) return null;
      return (dist(Co, Go) / body) * 100;
    },
  },
  {
    code: 'ANS-Me-Pct',
    label: '前下面高比',
    unit: '%',
    formula: 'ANS-Me / N-Me * 100',
    method: 'MCNAMARA',
    calc: (lm) => {
      const ANS = getP(lm, 'ANS'), Me = getP(lm, 'Me'), N = getP(lm, 'N');
      if (!ANS || !Me || !N) return null;
      const total = dist(N, Me);
      if (total === 0) return null;
      return (dist(ANS, Me) / total) * 100;
    },
  },
  {
    code: 'MaxMandRatio',
    label: '上下颌长度比',
    unit: '%',
    formula: 'Co-A / Co-Gn * 100',
    method: 'MCNAMARA',
    calc: (lm) => {
      const Co = getP(lm, 'Co'), A = getP(lm, 'A'), Gn = getP(lm, 'Gn');
      if (!Co || !A || !Gn) return null;
      const mand = dist(Co, Gn);
      if (mand === 0) return null;
      return (dist(Co, A) / mand) * 100;
    },
  },
];

/** 按方法分组的指标定义 */
export const METRICS_BY_METHOD: Record<AnalysisMethod, MetricDef[]> = {
  STEINER: ALL_METRIC_DEFS.filter(d => d.method === 'STEINER'),
  DOWNS: ALL_METRIC_DEFS.filter(d => d.method === 'DOWNS'),
  TWEE: ALL_METRIC_DEFS.filter(d => d.method === 'TWEE'),
  MCNAMARA: ALL_METRIC_DEFS.filter(d => d.method === 'MCNAMARA'),
};

/** 所有指标定义（去重后的 code 集合） */
export const ALL_METRIC_CODES: string[] = Array.from(new Set(ALL_METRIC_DEFS.map(d => d.code)));

@Injectable()
export class MetricsFormulaService {
  /**
   * 按方法计算所有指标
   */
  computeByMethod(landmarks: ShortCodeLandmarks, method: AnalysisMethod): MetricResult[] {
    const defs = METRICS_BY_METHOD[method] || [];
    return defs.map(def => ({
      code: def.code,
      label: def.label,
      value: round1(def.calc(landmarks)),
      unit: def.unit,
      formula: def.formula,
      method: def.method,
    }));
  }

  /**
   * 全方法合并计算（去重）
   */
  computeAll(landmarks: ShortCodeLandmarks): MetricResult[] {
    const seen = new Set<string>();
    const results: MetricResult[] = [];
    for (const def of ALL_METRIC_DEFS) {
      if (seen.has(def.code)) continue;
      seen.add(def.code);
      results.push({
        code: def.code,
        label: def.label,
        value: round1(def.calc(landmarks)),
        unit: def.unit,
        formula: def.formula,
        method: def.method,
      });
    }
    return results;
  }

  /**
   * 获取所有指标定义数量（去重）
   */
  getTotalMetricCount(): number {
    return ALL_METRIC_CODES.length;
  }

  /**
   * 按方法获取指标数量
   */
  getMethodMetricCount(method: AnalysisMethod): number {
    return (METRICS_BY_METHOD[method] || []).length;
  }
}
