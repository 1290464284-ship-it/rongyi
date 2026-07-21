import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

const schema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().length(4, '密码必须是4位数字').regex(/^\d{4}$/, '密码必须是4位数字'),
});

export default function LoginPage() {
  const nav = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [err, setErr] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: z.infer<typeof schema>) => {
    setErr('');
    try {
      const res = await api.post('/auth/login', data);
      login(res.data.user);
      nav('/');
    } catch (err: any) {
      if (err?.response?.status === 401) {
        setErr('用户名或密码错误');
      } else {
        setErr('登录失败，请稍后重试');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #154A8A 0%, #1E5AA8 40%, #00B3AA 100%)' }}>
      {/* 牙齿水印背景 */}
      <div className="absolute inset-0 opacity-[0.06] pointer-events-none select-none">
        <svg viewBox="0 0 800 600" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
          {Array.from({ length: 8 }).map((_, row) =>
            Array.from({ length: 5 }).map((_, col) => (
              <g key={`${row}-${col}`} transform={`translate(${120 + col * 160}, ${80 + row * 80}) scale(0.6)`}>
                <path d="M50 10 C35 5, 15 8, 8 25 C2 40, 5 55, 15 65 L50 90 L85 65 C95 55, 98 40, 92 25 C85 8, 65 5, 50 10Z" fill="white" />
                <path d="M50 90 L50 110" stroke="white" strokeWidth="3" />
                <path d="M38 85 L30 105" stroke="white" strokeWidth="2.5" />
                <path d="M62 85 L70 105" stroke="white" strokeWidth="2.5" />
              </g>
            ))
          )}
        </svg>
      </div>

      {/* 品牌区域 */}
      <div className="relative z-10 text-center mb-8 mr-12">
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-lg">
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M8 4 L8 20" />
              <path d="M16 4 L16 20" />
              <path d="M12 4 L12 20" />
              <path d="M6 12 L10 12 M14 12 L18 12" />
            </svg>
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-white tracking-wide">牙科管家</h1>
            <p className="text-sm text-white/70">Dental Clinic Management</p>
          </div>
        </div>

        <Card className="w-[380px] text-left">
          <CardHeader>
            <CardTitle>登录系统</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">用户名</Label>
                <Input id="username" {...register('username')} placeholder="boss" />
                {errors.username && (
                  <p className="text-xs text-destructive">{errors.username.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" {...register('password')} placeholder="••••" inputMode="numeric" maxLength={4} />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
              <Button type="submit" className="w-full bg-gradient-to-r from-primary to-secondary hover:from-primaryDark hover:to-secondary/90 transition-all duration-300" disabled={isSubmitting}>
                登录
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-white/50">本地私有部署 · 数据安全可控</p>
      </div>
    </div>
  );
}