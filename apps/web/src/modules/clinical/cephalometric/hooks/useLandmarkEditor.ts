import { useState, useCallback, useRef, useEffect } from 'react';
import {
  LANDMARK_CODES,
  REQUIRED_LANDMARKS,
  type Landmark,
  type LandmarkCode,
} from '@/lib/api/clinical/cephalometric';

export type EditorMode = 'place' | 'select' | 'pan';

const MAX_HISTORY = 50;
const DEBOUNCE_MS = 300;

function createInitialLandmarks(): Landmark[] {
  return LANDMARK_CODES.map((code) => ({ code, x: null, y: null }));
}

function cloneLandmarks(landmarks: Landmark[]): Landmark[] {
  return landmarks.map((l) => ({ ...l }));
}

export interface UseLandmarkEditorReturn {
  landmarks: Landmark[];
  past: Landmark[][];
  future: Landmark[][];
  selectedCode: LandmarkCode | null;
  mode: EditorMode;
  zoom: number;
  panOffset: { x: number; y: number };
  lockedCodes: Set<LandmarkCode>;

  setPoint: (code: LandmarkCode, x: number, y: number, opts?: { debounced?: boolean }) => void;
  deletePoint: (code: LandmarkCode) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setMode: (mode: EditorMode) => void;
  select: (code: LandmarkCode | null) => void;
  lock: (code: LandmarkCode, bool: boolean) => void;
  resetView: () => void;
  setZoom: (z: number) => void;
  setPanOffset: (o: { x: number; y: number }) => void;
  load: (landmarks: Landmark[]) => void;
  clearAll: () => void;
  getMissingRequired: () => LandmarkCode[];
  getLandmark: (code: LandmarkCode) => Landmark | undefined;
  flushPendingDebounce: () => void;
}

export function useLandmarkEditor(): UseLandmarkEditorReturn {
  const [landmarks, setLandmarks] = useState<Landmark[]>(createInitialLandmarks);
  const [past, setPast] = useState<Landmark[][]>([]);
  const [future, setFuture] = useState<Landmark[][]>([]);
  const [selectedCode, setSelectedCode] = useState<LandmarkCode | null>(null);
  const [mode, setMode] = useState<EditorMode>('place');
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [lockedCodes, setLockedCodes] = useState<Set<LandmarkCode>>(new Set());

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapshotRef = useRef<Landmark[] | null>(null);

  const pushHistory = useCallback((snapshot: Landmark[]) => {
    setPast((prev) => {
      const next = [...prev, cloneLandmarks(snapshot)];
      if (next.length > MAX_HISTORY) {
        return next.slice(next.length - MAX_HISTORY);
      }
      return next;
    });
    setFuture([]);
  }, []);

  const flushPendingDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingSnapshotRef.current) {
      pushHistory(pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
    }
  }, [pushHistory]);

  useEffect(() => () => flushPendingDebounce(), [flushPendingDebounce]);

  const setPoint = useCallback(
    (code: LandmarkCode, x: number, y: number, opts?: { debounced?: boolean }) => {
      if (lockedCodes.has(code)) return;

      setLandmarks((prev) => {
        const before = prev;
        const next = prev.map((l) =>
          l.code === code ? { ...l, x, y } : l
        );
        const snapshot = cloneLandmarks(before);

        if (opts?.debounced) {
          pendingSnapshotRef.current = snapshot;
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            if (pendingSnapshotRef.current) {
              pushHistory(pendingSnapshotRef.current);
              pendingSnapshotRef.current = null;
            }
            debounceTimerRef.current = null;
          }, DEBOUNCE_MS);
        } else {
          flushPendingDebounce();
          pushHistory(snapshot);
        }

        return next;
      });
    },
    [lockedCodes, pushHistory, flushPendingDebounce]
  );

  const deletePoint = useCallback(
    (code: LandmarkCode) => {
      if (lockedCodes.has(code)) return;
      flushPendingDebounce();
      setLandmarks((prev) => {
        pushHistory(cloneLandmarks(prev));
        return prev.map((l) => (l.code === code ? { ...l, x: null, y: null } : l));
      });
      setFuture([]);
    },
    [lockedCodes, pushHistory, flushPendingDebounce]
  );

  const undo = useCallback(() => {
    flushPendingDebounce();
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const newPast = [...prevPast];
      const prev = newPast.pop()!;
      setLandmarks((current) => {
        setFuture((f) => [cloneLandmarks(current), ...f]);
        return prev;
      });
      return newPast;
    });
  }, [flushPendingDebounce]);

  const redo = useCallback(() => {
    flushPendingDebounce();
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const [next, ...rest] = prevFuture;
      setLandmarks((current) => {
        setPast((p) => [...p, cloneLandmarks(current)]);
        return next;
      });
      return rest;
    });
  }, [flushPendingDebounce]);

  const select = useCallback((code: LandmarkCode | null) => {
    setSelectedCode(code);
  }, []);

  const lock = useCallback((code: LandmarkCode, bool: boolean) => {
    setLockedCodes((prev) => {
      const next = new Set(prev);
      if (bool) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const load = useCallback((data: Landmark[]) => {
    flushPendingDebounce();
    const map = new Map(data.map((l) => [l.code, l]));
    const next = LANDMARK_CODES.map(
      (code) => map.get(code) ?? { code, x: null, y: null }
    );
    setPast((p) => (landmarks.some((l) => l.x !== null) ? [...p, cloneLandmarks(landmarks)].slice(-MAX_HISTORY) : p));
    setLandmarks(next);
    setFuture([]);
  }, [landmarks, flushPendingDebounce]);

  const clearAll = useCallback(() => {
    flushPendingDebounce();
    setLandmarks((prev) => {
      pushHistory(cloneLandmarks(prev));
      return createInitialLandmarks();
    });
    setFuture([]);
  }, [pushHistory, flushPendingDebounce]);

  const getMissingRequired = useCallback((): LandmarkCode[] => {
    const placed = new Set(
      landmarks.filter((l) => l.x !== null && l.y !== null).map((l) => l.code)
    );
    return REQUIRED_LANDMARKS.filter((c) => !placed.has(c));
  }, [landmarks]);

  const getLandmark = useCallback(
    (code: LandmarkCode) => landmarks.find((l) => l.code === code),
    [landmarks]
  );

  return {
    landmarks,
    past,
    future,
    selectedCode,
    mode,
    zoom,
    panOffset,
    lockedCodes,
    setPoint,
    deletePoint,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    setMode,
    select,
    lock,
    resetView,
    setZoom,
    setPanOffset,
    load,
    clearAll,
    getMissingRequired,
    getLandmark,
    flushPendingDebounce,
  };
}
