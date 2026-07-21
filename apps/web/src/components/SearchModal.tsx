import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Search, X, Users, Calendar, Receipt, Stethoscope, Monitor, UserCog } from 'lucide-react';

export interface SearchResult {
  type: string;
  typeLabel: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

const TYPE_ICONS: Record<string, typeof Users> = {
  patient: Users,
  appointment: Calendar,
  charge: Receipt,
  treatment: Stethoscope,
  equipment: Monitor,
  user: UserCog,
};

const TYPE_COLORS: Record<string, string> = {
  patient: 'bg-primary/10 text-primary',
  appointment: 'bg-info/10 text-info',
  charge: 'bg-success/10 text-success',
  treatment: 'bg-warning/10 text-warning',
  equipment: 'bg-muted text-muted-foreground',
  user: 'bg-destructive/10 text-destructive',
};

export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setKeyword('');
        setResults([]);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (keyword.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<SearchResult[]>('/search', { params: { q: keyword } });
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword]);

  const handleSelect = (url: string) => {
    navigate(url);
    setOpen(false);
    setKeyword('');
    setResults([]);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 hover:bg-muted transition-colors text-sm"
      >
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground">搜索</span>
        <span className="text-xs text-muted-foreground/60">Ctrl+K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          
          <div className="relative w-full max-w-xl mx-4 bg-white rounded-xl shadow-2xl border border-border overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索患者、预约、收费、设备..."
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded transition-colors" aria-label="关闭搜索">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  搜索中...
                </div>
              )}

              {!loading && keyword.length >= 2 && results.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  未找到相关结果
                </div>
              )}

              {!loading && keyword.length < 2 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  输入至少2个字符开始搜索
                </div>
              )}

              {!loading && results.length > 0 && (
                <div className="py-2">
                  {results.map((result, index) => {
                    const Icon = TYPE_ICONS[result.type] || Search;
                    return (
                      <button
                        key={`${result.type}-${result.id}-${index}`}
                        onClick={() => handleSelect(result.url)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center ${TYPE_COLORS[result.type]}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{result.title}</div>
                          {result.subtitle && (
                            <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
                          )}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {result.typeLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
                    导航
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Enter</kbd>
                    选择
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Esc</kbd>
                    关闭
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
