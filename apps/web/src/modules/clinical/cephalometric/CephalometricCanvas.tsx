/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Pin, Undo, Redo, Crosshair, Image as ImageIcon, Layers, RefreshCw, Save,
  Download, Upload, ChevronRight, Printer, ZoomIn, ZoomOut, Maximize2,
  PlusCircle, XCircle, Info, ChevronLeft, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  LANDMARK_CODES,
  LANDMARK_LABELS,
  LANDMARK_COLORS,
  REQUIRED_LANDMARKS,
  type Landmark,
  type LandmarkCode,
} from '@/lib/api/clinical/cephalometric';
import { useLandmarkEditor, type EditorMode } from './hooks/useLandmarkEditor';

export { useLandmarkEditor };

const SVG_WIDTH = 800;
const SVG_HEIGHT = 600;
const GRID_MM = 10;
const MM_TO_PX = 2;
const CANVAS_W_MM = SVG_WIDTH / MM_TO_PX;
const CANVAS_H_MM = SVG_HEIGHT / MM_TO_PX;

const REFERENCE_LINES: Array<{ key: string; a: LandmarkCode; b: LandmarkCode; stroke: string; dash?: string }> = [
  { key: 'SN', a: 'S', b: 'N', stroke: '#3b82f6', dash: '6,4' },
  { key: 'NA', a: 'N', b: 'A', stroke: '#6b7280', dash: '4,3' },
  { key: 'NB', a: 'N', b: 'B', stroke: '#6b7280', dash: '4,3' },
  { key: 'ANS-PNS', a: 'ANS', b: 'PNS', stroke: '#a855f7', dash: '5,3' },
  { key: 'Go-Me', a: 'Go', b: 'Me', stroke: '#f97316', dash: '5,3' },
  { key: 'Go-Gn', a: 'Go', b: 'Gn', stroke: '#22c55e', dash: '5,3' },
  { key: 'Po-O', a: 'Po', b: 'O', stroke: '#9ca3af', dash: '3,3' },
];

function toSvg(x_mm: number, y_mm: number): [number, number] {
  return [x_mm * MM_TO_PX, SVG_HEIGHT - y_mm * MM_TO_PX];
}

function fromSvg(sx: number, sy: number): [number, number] {
  return [sx / MM_TO_PX, (SVG_HEIGHT - sy) / MM_TO_PX];
}

export interface CephalometricCanvasProps {
  editor?: ReturnType<typeof useLandmarkEditor>;
  onSave?: (landmarks: Landmark[]) => void;
  onAnalyze?: (landmarks: Landmark[]) => void;
  saving?: boolean;
  analyzing?: boolean;
}

export function CephalometricCanvas({
  editor: externalEditor,
  onSave,
  onAnalyze,
  saving,
  analyzing,
}: CephalometricCanvasProps) {
  const internalEditor = useLandmarkEditor();
  const editor = externalEditor ?? internalEditor;

  const {
    landmarks, past, future, selectedCode, mode, zoom, panOffset, lockedCodes,
    setPoint, deletePoint, undo, redo, canUndo, canRedo, setMode, select, lock,
    resetView, setZoom, setPanOffset, getMissingRequired, getLandmark,
  } = editor;

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTarget, setDragTarget] = useState<LandmarkCode | null>(null);
  const [dragStart, setDragStart] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(
    Object.fromEntries(REFERENCE_LINES.map((r) => [r.key, true]))
  );
  const [placeIndex, setPlaceIndex] = useState(0);

  const missing = useMemo(() => getMissingRequired(), [getMissingRequired]);
  const placeCode: LandmarkCode | null = mode === 'place' ? LANDMARK_CODES[placeIndex] ?? null : null;

  const getSvgCoord = useCallback((e: React.MouseEvent): { sx: number; sy: number } | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = SVG_WIDTH / rect.width;
    const scaleY = SVG_HEIGHT / rect.height;
    return {
      sx: (e.clientX - rect.left) * scaleX,
      sy: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const applyPanZoom = useCallback((sx: number, sy: number): [number, number] => {
    const cx = sx - SVG_WIDTH / 2;
    const cy = sy - SVG_HEIGHT / 2;
    const ux = cx / zoom - panOffset.x;
    const uy = cy / zoom - panOffset.y;
    return [ux + SVG_WIDTH / 2, uy + SVG_HEIGHT / 2];
  }, [zoom, panOffset]);

  const reversePanZoom = useCallback((x: number, y: number): [number, number] => {
    const cx = x - SVG_WIDTH / 2;
    const cy = y - SVG_HEIGHT / 2;
    const ux = cx * zoom + panOffset.x;
    const uy = cy * zoom + panOffset.y;
    return [ux + SVG_WIDTH / 2, uy + SVG_HEIGHT / 2];
  }, [zoom, panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const coord = getSvgCoord(e);
    if (!coord) return;
    const [ix, iy] = applyPanZoom(coord.sx, coord.sy);
    const [mx, my] = fromSvg(ix, iy);
    setMousePos({ x: mx, y: my });

    if (isDragging && dragTarget && dragStart) {
      const [tx, ty] = applyPanZoom(coord.sx, coord.sy);
      const [xmm, ymm] = fromSvg(tx, ty);
      setPoint(dragTarget, Math.round(xmm * 10) / 10, Math.round(ymm * 10) / 10, { debounced: true });
    } else if (isDragging && mode === 'pan' && dragStart) {
      const dx = (coord.sx - dragStart.sx) / zoom;
      const dy = (coord.sy - dragStart.sy) / zoom;
      setPanOffset({ x: dragStart.ox + dx, y: dragStart.oy + dy });
    }
  }, [getSvgCoord, applyPanZoom, isDragging, dragTarget, dragStart, mode, zoom, setPoint, setPanOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const coord = getSvgCoord(e);
    if (!coord) return;

    if (mode === 'pan') {
      setIsDragging(true);
      setDragStart({ sx: coord.sx, sy: coord.sy, ox: panOffset.x, oy: panOffset.y });
      return;
    }

    const [ix, iy] = applyPanZoom(coord.sx, coord.sy);
    const [xmm, ymm] = fromSvg(ix, iy);

    if (mode === 'place' && placeCode) {
      setPoint(placeCode, Math.round(xmm * 10) / 10, Math.round(ymm * 10) / 10);
      select(placeCode);
      setPlaceIndex((i) => {
        for (let j = i + 1; j < LANDMARK_CODES.length; j++) {
          const l = getLandmark(LANDMARK_CODES[j]);
          if (!l || l.x === null) return j;
        }
        return 0;
      });
      return;
    }

    if (mode === 'select') {
      let hit: LandmarkCode | null = null;
      for (const code of LANDMARK_CODES) {
        const l = getLandmark(code);
        if (!l || l.x === null || l.y === null) continue;
        const [lx, ly] = toSvg(l.x, l.y);
        const [rx, ry] = reversePanZoom(lx, ly);
        const d = Math.hypot(rx - coord.sx, ry - coord.sy);
        if (d < 12) { hit = code; break; }
      }
      if (hit) {
        select(hit);
        if (!lockedCodes.has(hit)) {
          setIsDragging(true);
          setDragTarget(hit);
          setDragStart({ sx: coord.sx, sy: coord.sy, ox: panOffset.x, oy: panOffset.y });
        }
      } else {
        select(null);
      }
    }
  }, [getSvgCoord, applyPanZoom, reversePanZoom, mode, placeCode, setPoint, select, getLandmark, lockedCodes, panOffset]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      editor.flushPendingDebounce();
    }
    setIsDragging(false);
    setDragTarget(null);
    setDragStart(null);
  }, [isDragging, editor]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(Math.min(3, Math.max(0.5, zoom * delta)));
  }, [zoom, setZoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const isMac = navigator.userAgent.includes('Mac');
      const cmd = isMac ? e.metaKey : e.ctrlKey;

      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (cmd && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redo(); return; }
      if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }

      if (selectedCode) {
        const step = e.shiftKey ? 2.0 : 0.5;
        const lm = getLandmark(selectedCode);
        if (lm && lm.x !== null && lm.y !== null) {
          if (e.key === 'ArrowUp') { e.preventDefault(); setPoint(selectedCode, lm.x, lm.y + step); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setPoint(selectedCode, lm.x, lm.y - step); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); setPoint(selectedCode, lm.x - step, lm.y); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); setPoint(selectedCode, lm.x + step, lm.y); }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deletePoint(selectedCode); }
      }

      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= 9) {
        const idx = n - 1;
        if (idx < LANDMARK_CODES.length) {
          setMode('place');
          setPlaceIndex(idx);
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [selectedCode, getLandmark, setPoint, deletePoint, undo, redo, setMode]);

  const goToLandmark = useCallback((code: LandmarkCode) => {
    const l = getLandmark(code);
    if (l && l.x !== null && l.y !== null) {
      const [sx, sy] = toSvg(l.x, l.y);
      setPanOffset({ x: SVG_WIDTH / 2 - sx, y: SVG_HEIGHT / 2 - sy });
    }
    select(code);
    setMode('place');
    const idx = LANDMARK_CODES.indexOf(code);
    if (idx >= 0) setPlaceIndex(idx);
  }, [getLandmark, select, setMode, setPanOffset]);

  const toggleLayer = (key: string) => setLayerVisibility((v) => ({ ...v, [key]: !v[key] }));

  const renderGrid = () => {
    const lines = [];
    const stepPx = GRID_MM * MM_TO_PX;
    for (let x = 0; x <= SVG_WIDTH; x += stepPx) {
      lines.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={SVG_HEIGHT} stroke="#e5e7eb" strokeWidth={1} />);
    }
    for (let y = 0; y <= SVG_HEIGHT; y += stepPx) {
      lines.push(<line key={`gy${y}`} x1={0} y1={y} x2={SVG_WIDTH} y2={y} stroke="#e5e7eb" strokeWidth={1} />);
    }
    return lines;
  };

  const renderRulers = () => {
    const texts = [];
    const stepPx = GRID_MM * MM_TO_PX;
    for (let x = 0; x <= SVG_WIDTH; x += stepPx) {
      texts.push(
        <text key={`rx${x}`} x={x + 2} y={10} fontSize={9} fill="#6b7280">
          {Math.round(x / MM_TO_PX)}
        </text>
      );
    }
    for (let y = 0; y <= SVG_HEIGHT; y += stepPx) {
      texts.push(
        <text key={`ry${y}`} x={2} y={SVG_HEIGHT - y - 2} fontSize={9} fill="#6b7280">
          {Math.round(y / MM_TO_PX)}
        </text>
      );
    }
    return texts;
  };

  const renderReferenceLines = () => {
    const els = [];
    for (const ref of REFERENCE_LINES) {
      if (!layerVisibility[ref.key]) continue;
      const la = getLandmark(ref.a);
      const lb = getLandmark(ref.b);
      if (!la || !lb || la.x === null || lb.x === null) continue;
      const [ax, ay] = toSvg(la.x, la.y!);
      const [bx, by] = toSvg(lb.x, lb.y!);
      els.push(
        <line key={ref.key} x1={ax} y1={ay} x2={bx} y2={by}
          stroke={ref.stroke} strokeWidth={1.5} strokeDasharray={ref.dash} opacity={0.8} />
      );
    }
    return els;
  };

  const transform = `translate(${panOffset.x * zoom + SVG_WIDTH / 2 * (1 - zoom)}, ${panOffset.y * zoom + SVG_HEIGHT / 2 * (1 - zoom)}) scale(${zoom})`;

  const landmarkByCode = useMemo(() => {
    const m = new Map<string, Landmark>();
    landmarks.forEach((l) => m.set(l.code, l));
    return m;
  }, [landmarks]);

  const cursorStyle =
    mode === 'pan' ? (isDragging ? 'grabbing' : 'grab')
    : mode === 'place' ? 'crosshair'
    : 'default';

  return (
    <div ref={containerRef} tabIndex={0} className="flex h-full w-full outline-none">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30 flex-wrap">
          <div className="flex items-center gap-1 bg-white rounded-md border border-border p-1">
            {(['place', 'select', 'pan'] as EditorMode[]).map((m) => (
              <Button key={m} variant={mode === m ? 'default' : 'ghost'} size="sm" onClick={() => setMode(m)}
                className="h-7 px-2 text-xs">
                {m === 'place' && <><Pin className="w-3 h-3 mr-1" />放置</>}
                {m === 'select' && <><Crosshair className="w-3 h-3 mr-1" />选择</>}
                {m === 'pan' && <><Maximize2 className="w-3 h-3 mr-1" />平移</>}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-white rounded-md border border-border p-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
              <Undo className="w-3 h-3 mr-1" />撤销
              <Badge className="ml-1 h-4 min-w-[16px] px-1 bg-muted text-xs">{past.length}</Badge>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
              <Redo className="w-3 h-3 mr-1" />重做
              <Badge className="ml-1 h-4 min-w-[16px] px-1 bg-muted text-xs">{future.length}</Badge>
            </Button>
          </div>

          <div className="flex items-center gap-1 bg-white rounded-md border border-border p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(Math.max(0.5, zoom / 1.2))} title="缩小">
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="text-xs px-2 min-w-[48px] text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(Math.min(3, zoom * 1.2))} title="放大">
              <ZoomIn className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetView} title="重置 1:1">
              <RefreshCw className="w-3 h-3 mr-1" />1:1
            </Button>
          </div>

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowLayers((s) => !s)} title="参考线">
            <Layers className="w-3 h-3 mr-1" />图层
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="上传影像">
              <Upload className="w-3 h-3 mr-1" />上传
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onAnalyze ? () => onAnalyze(landmarks) : undefined} disabled={analyzing}>
              {analyzing ? '分析中...' : <><BarChart3 className="w-3 h-3 mr-1" />分析</>}
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="下载 SVG">
              <Download className="w-3 h-3 mr-1" />SVG
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" title="打印">
              <Printer className="w-3 h-3 mr-1" />打印
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={onSave ? () => onSave(landmarks) : undefined} disabled={saving}>
              <Save className="w-3 h-3 mr-1" />{saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>

        {missing.length > 0 && (
          <div className="bg-destructive/10 text-destructive px-3 py-2 text-xs border-b border-destructive/20 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            <span>缺少 {missing.map((c) => `${c}(${LANDMARK_LABELS[c]})`).join('、')} 等 {missing.length} 个点</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto text-destructive hover:text-destructive"
              onClick={() => goToLandmark(missing[0])}>
              定位 <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}

        {showLayers && (
          <div className="bg-muted/20 px-3 py-2 border-b border-border text-xs flex items-center gap-3 flex-wrap">
            <span className="font-medium">参考线：</span>
            {REFERENCE_LINES.map((r) => (
              <label key={r.key} className="flex items-center gap-1 cursor-pointer">
                <Checkbox checked={layerVisibility[r.key]} onChange={() => toggleLayer(r.key)} className="h-3 w-3" />
                <span style={{ color: r.stroke }}>{r.key}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex-1 relative overflow-hidden bg-white">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="w-full h-full"
            style={{ cursor: cursorStyle }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setMousePos(null); handleMouseUp(); }}
            onWheel={handleWheel}
          >
            <defs>
              <pattern id="grid" width={GRID_MM * MM_TO_PX * 5} height={GRID_MM * MM_TO_PX * 5} patternUnits="userSpaceOnUse">
                <rect width="100%" height="100%" fill="white" />
              </pattern>
            </defs>
            <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#grid)" />
            <g transform={transform}>
              {renderGrid()}
              {renderRulers()}
              {renderReferenceLines()}

              {landmarks.map((l) => {
                const placed = l.x !== null && l.y !== null;
                const [sx, sy] = placed ? toSvg(l.x!, l.y!) : [0, 0];
                const isSel = l.code === selectedCode;
                const locked = lockedCodes.has(l.code);
                const color = LANDMARK_COLORS[l.code];
                return (
                  <g key={l.code} transform={placed ? `translate(${sx},${sy})` : undefined}
                    style={{ opacity: placed ? 1 : 0.4 }}>
                    {placed ? (
                      <>
                        <circle r={isSel ? 10 : 7} fill={color} stroke={isSel ? '#000' : 'white'} strokeWidth={isSel ? 2 : 1.5} opacity={locked ? 0.6 : 1} />
                        <text y={-12} fontSize={10} textAnchor="middle" fill={color} fontWeight={700}>{l.code}</text>
                      </>
                    ) : null}
                    {!placed && (
                      <text x={40 + (LANDMARK_CODES.indexOf(l.code) % 6) * 60} y={20 + Math.floor(LANDMARK_CODES.indexOf(l.code) / 6) * 18}
                        fontSize={9} fill="#9ca3af" stroke="#9ca3af" strokeWidth={0.5}>
                        ○ {l.code}
                      </text>
                    )}
                  </g>
                );
              })}

              {mode === 'place' && placeCode && mousePos && !isDragging && (() => {
                const [sx, sy] = toSvg(mousePos.x, mousePos.y);
                return (
                  <g transform={`translate(${sx},${sy})`}>
                    <line x1={-10} y1={0} x2={10} y2={0} stroke={LANDMARK_COLORS[placeCode]} strokeWidth={1.5} />
                    <line x1={0} y1={-10} x2={0} y2={10} stroke={LANDMARK_COLORS[placeCode]} strokeWidth={1.5} />
                    <circle r={8} fill="none" stroke={LANDMARK_COLORS[placeCode]} strokeWidth={1} strokeDasharray="2,2" />
                  </g>
                );
              })()}
            </g>
          </svg>

          {mousePos && (
            <div className="absolute bottom-2 right-2 bg-white/90 border border-border rounded px-2 py-1 text-xs font-mono">
              x: {mousePos.x.toFixed(1)} y: {mousePos.y.toFixed(1)} mm
            </div>
          )}
          {mode === 'place' && placeCode && (
            <div className="absolute top-2 left-2 bg-primary text-primary-foreground rounded px-2 py-1 text-xs">
              放置 {placeCode}（{LANDMARK_LABELS[placeCode]}）
            </div>
          )}
        </div>
      </div>

      <Card className="w-72 flex-shrink-0 border-l border-border rounded-none flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Pin className="w-4 h-4" />标志点清单
          </h3>
          <Badge variant="outline" className="text-xs">{landmarks.filter((l) => l.x !== null).length}/30</Badge>
        </div>
        <div className="flex-1 overflow-auto">
          {LANDMARK_CODES.map((code, i) => {
            const l = landmarkByCode.get(code)!;
            const isSel = code === selectedCode;
            const isPlace = code === placeCode;
            const placed = l.x !== null && l.y !== null;
            const required = REQUIRED_LANDMARKS.includes(code);
            const locked = lockedCodes.has(code);
            return (
              <div key={code}
                className={`px-3 py-2 border-b border-border cursor-pointer flex items-center gap-2 text-xs
                  ${isSel ? 'bg-primary/10' : isPlace ? 'bg-secondary/10' : 'hover:bg-muted/50'}`}
                onClick={() => goToLandmark(code)}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: LANDMARK_COLORS[code] }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-semibold">{code}</span>
                    {required && <Badge className="h-3 px-1 text-[10px] bg-destructive/20 text-destructive border-0">必</Badge>}
                    {locked && <Badge className="h-3 px-1 text-[10px] bg-muted text-muted-foreground border-0">锁</Badge>}
                    <span className="ml-1 text-[10px] text-muted-foreground">#{i + 1}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{LANDMARK_LABELS[code]}</div>
                </div>
                {placed ? (
                  <div className="text-[10px] font-mono text-right flex-shrink-0">
                    <div>{l.x!.toFixed(1)}</div>
                    <div>{l.y!.toFixed(1)}</div>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic flex-shrink-0">未放置</span>
                )}
                <div className="flex items-center gap-0.5 ml-1">
                  <Button variant="ghost" size="icon" className="h-5 w-5"
                    onClick={(e) => { e.stopPropagation(); lock(code, !locked); }} title={locked ? '解锁' : '锁定'}>
                    {locked ? <Info className="w-3 h-3" /> : <XCircle className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5"
                    onClick={(e) => { e.stopPropagation(); goToLandmark(code); }} title="定位">
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

CephalometricCanvas.displayName = 'CephalometricCanvas';
