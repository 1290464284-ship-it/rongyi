import { ListTodo } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function StatCard({
  title,
  value,
  icon: Icon,
  color,
  bgColor,
}: {
  title: string;
  value: number | string;
  icon: typeof ListTodo;
  color: string;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{title}</div>
            <div className="text-3xl font-bold mt-1">{value}</div>
          </div>
          <div className={`w-12 h-12 ${bgColor} rounded-lg flex items-center justify-center`}>
            <Icon className={`w-6 h-6 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="w-full h-2 bg-muted/30 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
