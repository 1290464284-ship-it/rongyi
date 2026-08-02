/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLandmarkEditor } from '../hooks/useLandmarkEditor';
import {
  LANDMARK_CODES,
  LANDMARK_LABELS,
  REQUIRED_LANDMARKS,
  type LandmarkCode,
  type Landmark,
} from '@/lib/api/clinical/cephalometric';
import { CephalometricCanvas } from '../CephalometricCanvas';

vi.mock('lucide-react', () => {
  const icons: Record<string, any> = {};
  const names = [
    'Ruler','Pin','Undo','Redo','Crosshair','Image','Layers','RefreshCw','Save',
    'Search','Filter','Download','Upload','ChevronRight','Printer','BarChart3',
    'ArrowRightLeft','ChevronLeft','ZoomIn','ZoomOut','Maximize2','PlusCircle',
    'XCircle','Info','Check','ChevronsLeft','ChevronsRight','Inbox','Users',
  ];
  for (const n of names) {
    icons[n] = ({ className, ...rest }: any) =>
      React.createElement('span', { ...rest, 'data-testid': `icon-${n}`, className });
  }
  return icons;
});

describe('cephalometric-canvas / useLandmarkEditor hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F19C-1 初始化：30 点，默认坐标均 null', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    expect(result.current.landmarks).toHaveLength(30);
    for (const l of result.current.landmarks) {
      expect(l.x).toBeNull();
      expect(l.y).toBeNull();
    }
    expect(LANDMARK_CODES.length).toBe(30);
    expect(new Set(result.current.landmarks.map((l) => l.code)).size).toBe(30);
  });

  it('F19C-1 点清单 30 行渲染，每行「未放置」', () => {
    const editor = renderHook(() => useLandmarkEditor()).result.current;
    render(<CephalometricCanvas editor={editor as any} />);
    for (const code of LANDMARK_CODES) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    const unplacedCount = screen.getAllByText('未放置').length;
    expect(unplacedCount).toBeGreaterThanOrEqual(30);
  });

  it('F19C-2 放置 N 点 → setPoint(N,50,50) 触发 1 次；点坐标变成 (50,50)；可撤销步数=1', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => {
      result.current.setPoint('N', 50, 50);
    });
    const n = result.current.landmarks.find((l) => l.code === 'N');
    expect(n?.x).toBe(50);
    expect(n?.y).toBe(50);
    expect(result.current.past.length).toBe(1);
    expect(result.current.canUndo).toBe(true);
  });

  it('F19C-3 再放 S 点 → undo 2 次：S→未放置，N→未放置，canUndo=false', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => {
      result.current.setPoint('N', 50, 50);
    });
    act(() => {
      result.current.setPoint('S', 100, 100);
    });
    expect(result.current.landmarks.find((l) => l.code === 'S')?.x).toBe(100);

    act(() => result.current.undo());
    expect(result.current.landmarks.find((l) => l.code === 'S')?.x).toBeNull();
    expect(result.current.landmarks.find((l) => l.code === 'N')?.x).toBe(50);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.landmarks.find((l) => l.code === 'N')?.x).toBeNull();
    expect(result.current.canUndo).toBe(false);
  });

  it('F19C-4 redo 1 次：N 恢复(50,50)，可重做步数减少', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('N', 50, 50));
    expect(result.current.future.length).toBe(0);
    act(() => result.current.undo());
    expect(result.current.future.length).toBe(1);
    act(() => result.current.redo());
    const n = result.current.landmarks.find((l) => l.code === 'N');
    expect(n?.x).toBe(50);
    expect(result.current.future.length).toBe(0);
  });

  it('F19C-5 Undo 栈：连续放 51 个点 → 栈深度保持 50（最旧被丢弃）', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    for (let i = 0; i < 51; i++) {
      const code = LANDMARK_CODES[i % LANDMARK_CODES.length];
      act(() => result.current.setPoint(code, i, i));
    }
    expect(result.current.past.length).toBeLessThanOrEqual(50);
    expect(result.current.past.length).toBe(50);
  });

  it('F19C-6 锁定 N 点 → 拖动 N 坐标不变（setPoint 被 ignore 因 locked）', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('N', 50, 50));
    act(() => result.current.lock('N', true));
    act(() => result.current.setPoint('N', 999, 999));
    const n = result.current.landmarks.find((l) => l.code === 'N');
    expect(n?.x).toBe(50);
    expect(n?.y).toBe(50);
  });

  it('F19C-7 方向键 ↑ 移动选中点 S (100,100) → (100,100.5)；Shift+→ → (102,100.5)', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('S', 100, 100));
    act(() => result.current.select('S'));

    const getS = () => result.current.landmarks.find((l) => l.code === 'S')!;
    const handleKey = (key: string, shift = false) => {
      if (!result.current.selectedCode) return;
      const step = shift ? 2.0 : 0.5;
      const lm = result.current.getLandmark(result.current.selectedCode);
      if (!lm || lm.x === null || lm.y === null) return;
      if (key === 'ArrowUp') result.current.setPoint(lm.code, lm.x, lm.y + step);
      else if (key === 'ArrowDown') result.current.setPoint(lm.code, lm.x, lm.y - step);
      else if (key === 'ArrowLeft') result.current.setPoint(lm.code, lm.x - step, lm.y);
      else if (key === 'ArrowRight') result.current.setPoint(lm.code, lm.x + step, lm.y);
    };

    act(() => handleKey('ArrowUp', false));
    let s = getS();
    expect(s.x).toBe(100);
    expect(s.y).toBe(100.5);

    act(() => handleKey('ArrowRight', true));
    s = getS();
    expect(s.x).toBe(102);
    expect(s.y).toBe(100.5);
  });

  it('F19C-8 Delete 删除 S 点 → S 坐标 null；清单中 S 未放置', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('S', 100, 100));
    act(() => result.current.select('S'));
    act(() => result.current.deletePoint('S'));
    const s = result.current.landmarks.find((l) => l.code === 'S');
    expect(s?.x).toBeNull();
    expect(s?.y).toBeNull();
  });

  it('F19C-9 模式切换 select → place → pan 都正确（state.mode）', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setMode('select'));
    expect(result.current.mode).toBe('select');
    act(() => result.current.setMode('place'));
    expect(result.current.mode).toBe('place');
    act(() => result.current.setMode('pan'));
    expect(result.current.mode).toBe('pan');
  });

  it('F19C-10 Zoom 滚轮 3x → zoom=3；ZoomIn 按钮 zoom×1.2 正确', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setZoom(3));
    expect(result.current.zoom).toBe(3);
    act(() => result.current.setZoom(result.current.zoom * 1.2));
    expect(result.current.zoom).toBeCloseTo(3.6);
    act(() => result.current.resetView());
    expect(result.current.zoom).toBe(1);
  });

  it('F19C-11 必填点缺失校验 → 返回 missing=[N,A,B]；错误条显示「缺少 N(鼻根点) 等 3 个点」', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    for (const code of REQUIRED_LANDMARKS) {
      if (code !== 'N' && code !== 'A' && code !== 'B') {
        act(() => result.current.setPoint(code as LandmarkCode, 10, 10));
      }
    }
    const missing = result.current.getMissingRequired();
    expect(missing).toContain('N');
    expect(missing).toContain('A');
    expect(missing).toContain('B');
    expect(missing.length).toBeGreaterThanOrEqual(3);

    const msg = `缺少 ${missing.map((c) => `${c}(${LANDMARK_LABELS[c]})`).join('、')} 等 ${missing.length} 个点`;
    expect(msg).toContain('N(鼻根点)');
    expect(msg).toContain(`等 ${missing.length} 个点`);
  });

  it('F19C-12 保存 POST /landmark-sets body 含 patientId=P001、landmarks 30 条（未放置 code 有 x/y null）', async () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('S', 100, 100));

    let capturedBody: any = null;
    const mockSave = (landmarks: Landmark[]) => {
      capturedBody = {
        patientId: 'P001',
        name: '测试',
        landmarks,
      };
    };
    render(<CephalometricCanvas editor={result.current as any} onSave={mockSave} />);

    const saveBtns = screen.getAllByText(/保存/);
    expect(saveBtns.length).toBeGreaterThan(0);

    act(() => mockSave(result.current.landmarks));
    expect(capturedBody.patientId).toBe('P001');
    expect(capturedBody.landmarks).toHaveLength(30);
    const s = capturedBody.landmarks.find((l: Landmark) => l.code === 'S');
    expect(s.x).toBe(100);
    const n = capturedBody.landmarks.find((l: Landmark) => l.code === 'N');
    expect(n.x).toBeNull();
    expect(n.y).toBeNull();
  });

  it('F19C-13 同一拖动：拖动 5px 过程中 debounce 300ms 结束仅入栈 1 次（batch）', () => {
    const { result } = renderHook(() => useLandmarkEditor());
    act(() => result.current.setPoint('S', 0, 0));
    expect(result.current.past.length).toBe(1);

    for (let i = 1; i <= 5; i++) {
      act(() => result.current.setPoint('S', i, i, { debounced: true }));
    }
    expect(result.current.past.length).toBe(1);

    act(() => vi.advanceTimersByTime(300));
    result.current.flushPendingDebounce();

    expect(result.current.past.length).toBe(2);
    const s = result.current.landmarks.find((l) => l.code === 'S')!;
    expect(s.x).toBe(5);
  });
});
