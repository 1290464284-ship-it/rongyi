import { Point2D, Landmarks } from './cephalometric-landmarks';

export interface ReferencePlane {
  A: Point2D;
  B: Point2D;
}

export interface ReferencePlanes {
  FH: ReferencePlane | null;
  SN: ReferencePlane | null;
  OP: ReferencePlane | null;
  MP: ReferencePlane | null;
  PP: ReferencePlane | null;
}

export interface ProjectionResult {
  foot: Point2D;
  distance: number;
}

const ALIAS_MAP: Record<string, string> = {
  APoint: 'A-point',
  BPoint: 'B-point',
  UI: 'Upper Incisor Edge',
  UIR: 'Upper Incisor Root',
  LI: 'Lower Incisor Edge',
  LIR: 'Lower Incisor Root',
  U6: 'Upper 1st Mesiobuccal',
  L6: 'Lower 1st Mesiobuccal',
  PointW: 'Point W',
};

function normalize(lm: Landmarks): Landmarks {
  if (!lm) return {};
  const out: Landmarks = {};
  for (const key of Object.keys(lm)) {
    const target = ALIAS_MAP[key] || key;
    out[target] = lm[key];
  }
  return out;
}

function hasPoint(lm: Landmarks, key: string): Point2D | null {
  const p = lm[key];
  if (!p) return null;
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function calcReferencePlanes(landmarks: Landmarks): ReferencePlanes {
  const lm = normalize(landmarks);
  const result: ReferencePlanes = {
    FH: null,
    SN: null,
    OP: null,
    MP: null,
    PP: null,
  };

  const Pt = hasPoint(lm, 'Porion');
  const O = hasPoint(lm, 'Orbitale');
  if (Pt && O) {
    result.FH = { A: Pt, B: O };
  }

  const S = hasPoint(lm, 'Sella');
  const N = hasPoint(lm, 'Nasion');
  if (S && N) {
    result.SN = { A: S, B: N };
  }

  const U6 = hasPoint(lm, 'Upper 1st Mesiobuccal');
  const L6 = hasPoint(lm, 'Lower 1st Mesiobuccal');
  if (U6 && L6) {
    result.OP = { A: U6, B: L6 };
  }

  const Me = hasPoint(lm, 'Menton');
  const Go = hasPoint(lm, 'Gonion');
  if (Me && Go) {
    result.MP = { A: Me, B: Go };
  }

  const ANS = hasPoint(lm, 'ANS');
  const PNS = hasPoint(lm, 'PNS');
  if (ANS && PNS) {
    result.PP = { A: ANS, B: PNS };
  }

  return result;
}

export function projectToLine(point: Point2D, line: ReferencePlane): ProjectionResult {
  const dx = line.B.x - line.A.x;
  const dy = line.B.y - line.A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { foot: line.A, distance: 0 };
  }
  const t = ((point.x - line.A.x) * dx + (point.y - line.A.y) * dy) / lenSq;
  const foot = {
    x: line.A.x + t * dx,
    y: line.A.y + t * dy,
  };
  const distance = euclideanDistance(point, foot);
  return { foot, distance };
}

export function projectToLineSigned(point: Point2D, line: ReferencePlane): { foot: Point2D; signed: number } {
  const proj = projectToLine(point, line);
  const dx = line.B.x - line.A.x;
  const dy = line.B.y - line.A.y;
  const nx = -dy;
  const ny = dx;
  const vx = point.x - line.A.x;
  const vy = point.y - line.A.y;
  const sign = (vx * nx + vy * ny) >= 0 ? 1 : -1;
  return { foot: proj.foot, signed: sign * proj.distance };
}

export function euclideanDistance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function vectorAngleDeg(a: Point2D, b: Point2D, c: Point2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 === 0 || m2 === 0) return 0;
  let cosVal = dot / (m1 * m2);
  if (cosVal > 1) cosVal = 1;
  if (cosVal < -1) cosVal = -1;
  const acos = Math.acos(cosVal);
  return (acos * 180) / Math.PI;
}

export function lineIntersection(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-10) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  return {
    x: p1.x + ua * (p2.x - p1.x),
    y: p1.y + ua * (p2.y - p1.y),
  };
}

export function unitNormal(plane: ReferencePlane): { nx: number; ny: number } {
  const dx = plane.B.x - plane.A.x;
  const dy = plane.B.y - plane.A.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { nx: 0, ny: 0 };
  return { nx: -dy / len, ny: dx / len };
}

/**
 * 两线段夹角（Task 19）
 * 线段1: p1→p2, 线段2: p3→p4
 * 返回 [0, 180] 度的夹角
 */
export function angleBetweenLines(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): number {
  const v1x = p2.x - p1.x;
  const v1y = p2.y - p1.y;
  const v2x = p4.x - p3.x;
  const v2y = p4.y - p3.y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 === 0 || m2 === 0) return 0;
  let cosVal = (v1x * v2x + v1y * v2y) / (m1 * m2);
  if (cosVal > 1) cosVal = 1;
  if (cosVal < -1) cosVal = -1;
  return (Math.acos(cosVal) * 180) / Math.PI;
}

/**
 * 两线段夹角别名（语义同 angleBetweenLines，供公式库引用）
 */
export const lineAngleDeg = angleBetweenLines;

/**
 * 点到平面（直线）的投影角（Task 19）
 * 返回点 p 到 plane 的垂线与水平方向的夹角
 */
export function angleToPlane(point: Point2D, plane: ReferencePlane): number {
  const proj = projectToLine(point, plane);
  const dx = point.x - proj.foot.x;
  const dy = point.y - proj.foot.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export { midpoint };
