import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useChangePassword } from '@/lib/auth';
import { useCurrentClinic } from '@/lib/api/system/clinics';
import { toast } from 'sonner';
import { LogOut, ChevronDown, KeyRound, User as UserIcon, Building2, Minus, Square, X } from 'lucide-react';
import SearchModal from '@/components/SearchModal';

const roleLabels: Record<string, string> = {
  BOSS: '老板',
  DOCTOR: '医生',
  RECEPTIONIST: '前台',
};

function WindowControls() {
  const bridge = typeof window !== 'undefined' ? window.dentalBridge : undefined;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    bridge.windowActions.getIsMaximized().then(setIsMaximized).catch(() => undefined);
    const handler = (_e: Event, maximized: boolean) => {
      setIsMaximized(!!maximized);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron IPC 自定义事件类型
    window.addEventListener('window:maximize-changed' as any, handler as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron IPC 自定义事件类型
      window.removeEventListener('window:maximize-changed' as any, handler as any);
    };
  }, [bridge]);

  if (!bridge) return null;

  const isMac = bridge.platform === 'darwin';
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div
      className={`flex items-center gap-1 ${
        isMac ? 'absolute left-3 top-3 z-10' : 'ml-3'
      }`}
      data-testid="window-controls"
    >
      {children}
    </div>
  );

  const baseBtn =
    'h-8 w-8 flex items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none';
  const closeBtnExtra = isMac
    ? 'hover:bg-red-500 hover:text-white'
    : 'hover:bg-red-500 hover:text-white';

  const handleMin = () => {
    try {
      bridge.windowActions.minimize();
    } catch {
      /* ignore */
    }
  };
  const handleMax = () => {
    try {
      bridge.windowActions.toggleMaximize().then((next) => setIsMaximized(!!next)).catch(() => undefined);
    } catch {
      /* ignore */
    }
  };
  const handleClose = () => {
    try {
      bridge.windowActions.closeOrHideToTray();
    } catch {
      /* ignore */
    }
  };

  return (
    <Wrapper>
      {isMac ? (
        <>
          <button
            type="button"
            aria-label="关闭"
            className={`${baseBtn} ${closeBtnExtra}`}
            onClick={handleClose}
            data-testid="window-close"
          >
            <X className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label="最小化"
            className={baseBtn}
            onClick={handleMin}
            data-testid="window-minimize"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label="最大化"
            className={baseBtn}
            onClick={handleMax}
            data-testid="window-maximize"
          >
            <Square className="w-3 h-3" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label="最小化"
            className={baseBtn}
            onClick={handleMin}
            data-testid="window-minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="最大化"
            className={baseBtn}
            onClick={handleMax}
            data-testid="window-maximize"
          >
            {isMaximized ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3h13v13" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 8h13v13H3z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label="关闭"
            className={`${baseBtn} ${closeBtnExtra}`}
            onClick={handleClose}
            data-testid="window-close"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}
    </Wrapper>
  );
}

export default function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { data: clinic } = useCurrentClinic();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const onSwitchAccount = () => {
    setMenuOpen(false);
    logout();
    window.location.href = '#/login';
  };

  const onChangePassword = () => {
    setMenuOpen(false);
    setPwdOpen(true);
  };

  const bridge = typeof window !== 'undefined' ? window.dentalBridge : undefined;
  const isMac = bridge?.platform === 'darwin';

  return (
    <header className="h-14 border-b border-border bg-white flex items-center justify-between px-6 relative">
      {isMac && <WindowControls />}
      <div className={`flex items-center gap-4 ${isMac ? 'ml-16' : ''}`}>
        {clinic?.name && (
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground" title={`当前诊所：${clinic.name}`}>
            <Building2 className="w-4 h-4 text-primary" />
            <span>{clinic.name}</span>
          </div>
        )}
        <div className="text-sm text-muted-foreground">{today}</div>
      </div>
      <div className="flex items-center gap-3">
        <SearchModal />
        <div className="relative" ref={menuRef}>
          <button
            className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/50 transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
              {user?.name?.[0] ?? '?'}
            </div>
            <div className="text-left">
              <div className="text-sm font-medium leading-tight">{user?.name}</div>
              <div className="text-xs text-muted-foreground leading-tight">
                {user ? roleLabels[user.role] ?? user.role : ''}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-border rounded-lg shadow-lg py-1 z-50">
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2 text-sm">
                  <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{user?.name}</span>
                </div>
                <div className="text-xs text-muted-foreground ml-5 mt-0.5">
                  {user ? roleLabels[user.role] ?? user.role : ''}
                </div>
              </div>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left"
                onClick={onChangePassword}
              >
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                修改密码
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left text-destructive"
                onClick={onSwitchAccount}
              >
                <LogOut className="w-3.5 h-3.5" />
                切换账号
              </button>
            </div>
          )}
        </div>
        {!isMac && <WindowControls />}
      </div>

      <ChangePasswordDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </header>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const changePassword = useChangePassword();

  async function handleSubmit() {
    if (!oldPwd || !newPwd || !confirmPwd) return;
    if (newPwd.length < 4 || newPwd.length > 32) {
      toast.error('新密码长度需在4-32位之间');
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    try {
      await changePassword.mutateAsync({ oldPassword: oldPwd, newPassword: newPwd });
      toast.success('密码修改成功');
      onClose();
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : '密码修改失败');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>修改密码</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="oldPassword">原密码</Label>
            <Input
              id="oldPassword"
              type="password"
              value={oldPwd}
              onChange={e => setOldPwd(e.target.value)}
              placeholder="输入当前密码"
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">新密码</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="4位数字"
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">确认新密码</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="再次输入新密码"
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSubmit} disabled={changePassword.isPending || !oldPwd || !newPwd || !confirmPwd}>
              确认修改
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
