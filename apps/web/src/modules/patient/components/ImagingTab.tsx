import { useNavigate } from 'react-router-dom';
import { Image as ImageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { IMAGING_TYPE_LABEL, IMAGING_TYPE_COLOR } from '@/lib/api/content/imaging';
import type { Imaging } from '@/lib/api/content/imaging';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function ImagingTab({ imagings, patientId }: { imagings: Imaging[]; patientId: string }) {
  const nav = useNavigate();

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <h2 className="text-sm font-medium mb-2">影像记录</h2>
      {imagings.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无影像记录</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {imagings.map((img) => (
            <div
              key={img.id}
              className="border border-border rounded-md overflow-hidden cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => nav(`/imaging?patientId=${patientId}`)}
            >
              <div className="aspect-video bg-muted flex items-center justify-center relative">
                {img.thumbnailUrl || img.imageUrl ? (
                  <img
                    src={img.thumbnailUrl || img.imageUrl}
                    alt={img.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                )}
                <div className="absolute top-1 left-1">
                  <Badge className={IMAGING_TYPE_COLOR[img.type as keyof typeof IMAGING_TYPE_COLOR]}>{IMAGING_TYPE_LABEL[img.type as keyof typeof IMAGING_TYPE_LABEL]}</Badge>
                </div>
              </div>
              <div className="p-2">
                <div className="text-sm font-medium truncate">{img.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {img.takenAt ? format(new Date(img.takenAt), 'yyyy-MM-dd', { locale: zhCN }) : '-'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
