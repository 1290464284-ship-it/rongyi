import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  const nav = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4">
        <div className="text-6xl font-bold text-muted-foreground/30">404</div>
        <h2 className="text-xl font-semibold text-foreground">页面不存在</h2>
        <p className="text-sm text-muted-foreground">请检查网址是否正确，或返回首页</p>
        <Button onClick={() => nav('/dashboard')} variant="outline">
          <Home className="w-4 h-4 mr-2" />
          返回首页
        </Button>
      </div>
    </div>
  );
}