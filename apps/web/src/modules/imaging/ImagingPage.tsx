import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Eye,
  Trash2,
  Check,
  X,
  Image as ImageIcon,
  Calendar,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useImagingList,
  useCreateImaging,
  useDeleteImaging,
  IMAGING_TYPE_LABEL,
  IMAGING_TYPE_COLOR,
  type Imaging,
  type ImagingType,
} from '@/lib/imaging';
import { PatientSelector } from '@/components/patient/PatientSelector';
import { useStaff } from '@/lib/staff';
import { useAuthStore } from '@/lib/auth-store';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function ImagingPage() {
  const [searchParams] = useSearchParams();
  const presetPatientId = searchParams.get('patientId') ?? '';

  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<ImagingType | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [viewOpen, setViewOpen] = useState(false);
  const [selectedImg, setSelectedImg] = useState<Imaging | null>(null);
  const [createOpen, setCreateOpen] = useState(() => !!presetPatientId);

  const { data, isLoading } = useImagingList({
    type: typeFilter || undefined,
    page,
    pageSize,
  });

  const createImg = useCreateImaging();
  const deleteImg = useDeleteImaging();

  const imagings = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = useMemo(() => {
    if (!keyword) return imagings;
    const kw = keyword.toLowerCase();
    return imagings.filter(
      i =>
        i.title?.toLowerCase().includes(kw) ||
        i.patient?.name?.toLowerCase().includes(kw) ||
        i.description?.toLowerCase().includes(kw),
    );
  }, [imagings, keyword]);

  function handleView(img: Imaging) {
    setSelectedImg(img);
    setViewOpen(true);
  }

  function handleDelete(id: string) {
    if (!confirm('确定删除该影像记录？')) return;
    deleteImg.mutate(id);
  }

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>影像管理</h1>
          <p className='text-sm text-muted-foreground mt-1'>
            管理患者口腔影像资料（全景片、根尖片、CBCT等）
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className='w-4 h-4 mr-2' />
          添加影像
        </Button>
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center gap-4'>
            <div className='flex-1 max-w-sm'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
                <Input
                  placeholder='搜索标题/患者/描述'
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  className='pl-10'
                />
              </div>
            </div>
            <Select
              value={typeFilter}
              onChange={e => {
                setTypeFilter(e.target.value as ImagingType | '');
                setPage(1);
              }}
              className='w-36'
            >
              <option value=''>全部类型</option>
              <option value='PANORAMIC'>全景片</option>
              <option value='PERIAPICAL'>根尖片</option>
              <option value='BITEWING'>咬翼片</option>
              <option value='CBCT'>锥形束CT</option>
              <option value='INTRAORAL'>口内照片</option>
              <option value='EXTRAORAL'>口外照片</option>
              <option value='OTHER'>其他</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='text-center py-12 text-muted-foreground'>加载中...</div>
          ) : filtered.length === 0 ? (
            <div className='text-center py-12 text-muted-foreground'>
              <ImageIcon className='w-12 h-12 mx-auto mb-3 opacity-30' />
              <p>暂无影像记录</p>
            </div>
          ) : (
            <>
              <div className='grid grid-cols-4 gap-4'>
                {filtered.map(img => (
                  <ImagingCard
                    key={img.id}
                    img={img}
                    onView={() => handleView(img)}
                    onDelete={() => handleDelete(img.id)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className='flex items-center justify-end gap-2 mt-4'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={page === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <span className='text-sm text-muted-foreground'>
                    {page} / {totalPages} 页
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={page === totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selectedImg && (
        <Dialog open={viewOpen} onClose={() => setViewOpen(false)} className='max-w-3xl'>
          <DialogHeader>
            <DialogTitle>{selectedImg.title}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <ImagingDetail img={selectedImg} />
            <div className='no-print flex justify-end gap-2 mt-4'>
              <Button variant='outline' onClick={() => setViewOpen(false)}>
                关闭
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <CreateImagingDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        presetPatientId={presetPatientId}
        onCreate={createImg.mutateAsync}
      />
    </div>
  );
}

function ImagingCard({
  img,
  onView,
  onDelete,
}: {
  img: Imaging;
  onView: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className='overflow-hidden cursor-pointer hover:shadow-md transition-shadow' >
      <div
        className='aspect-video bg-muted flex items-center justify-center relative group'
        onClick={onView}
      >
        {img.thumbnailUrl || img.imageUrl ? (
          <img
            src={img.thumbnailUrl || img.imageUrl}
            alt={img.title}
            className='w-full h-full object-cover'
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ImageIcon className='w-12 h-12 text-muted-foreground/30' />
        )}
        <div className='absolute top-2 left-2'>
          <Badge className={IMAGING_TYPE_COLOR[img.type]}>
            {IMAGING_TYPE_LABEL[img.type]}
          </Badge>
        </div>
      </div>
      <CardContent className='p-3'>
        <div className='font-medium text-sm truncate' onClick={onView}>
          {img.title}
        </div>
        <div className='text-xs text-muted-foreground mt-1'>
          {img.patient?.name}
        </div>
        <div className='flex items-center justify-between mt-2'>
          <span className='text-xs text-muted-foreground'>
            {img.takenAt ? format(new Date(img.takenAt), 'yyyy-MM-dd', { locale: zhCN }) : '-'}
          </span>
          <Button size='sm' variant='ghost' onClick={onDelete}>
            <Trash2 className='w-3 h-3 text-destructive' />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImagingDetail({ img }: { img: Imaging }) {
  return (
    <div className='space-y-4'>
      <div className='bg-muted rounded-md overflow-hidden flex items-center justify-center min-h-[300px]'>
        {img.imageUrl ? (
          <img
            src={img.imageUrl}
            alt={img.title}
            className='max-w-full max-h-[500px] object-contain'
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ImageIcon className='w-16 h-16 text-muted-foreground/30' />
        )}
      </div>

      <div className='grid grid-cols-3 gap-4 text-sm'>
        <div>
          <div className='text-muted-foreground flex items-center gap-1'>
            <User className='w-3 h-3' />
            <span>患者</span>
          </div>
          <div className='font-medium'>{img.patient?.name}</div>
        </div>
        <div>
          <div className='text-muted-foreground flex items-center gap-1'>
            <Calendar className='w-3 h-3' />
            <span>拍摄日期</span>
          </div>
          <div className='font-medium'>
            {img.takenAt ? format(new Date(img.takenAt), 'yyyy-MM-dd', { locale: zhCN }) : '-'}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground'>类型</div>
          <div>
            <Badge className={IMAGING_TYPE_COLOR[img.type]}>
              {IMAGING_TYPE_LABEL[img.type]}
            </Badge>
          </div>
        </div>
      </div>

      {img.description && (
        <div>
          <div className='text-xs text-muted-foreground mb-1'>描述</div>
          <div className='text-sm bg-muted/30 p-3 rounded'>{img.description}</div>
        </div>
      )}

      {img.remark && (
        <div>
          <div className='text-xs text-muted-foreground mb-1'>备注</div>
          <div className='text-sm bg-muted/30 p-3 rounded'>{img.remark}</div>
        </div>
      )}

      {img.doctor && (
        <div className='text-sm text-muted-foreground'>
          拍摄医生：{img.doctor.name}
        </div>
      )}
    </div>
  );
}

function CreateImagingDialog({
  open,
  onClose,
  presetPatientId,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  presetPatientId?: string;
  onCreate: (data: any) => Promise<any>;
}) {
  const [openSelector, setOpenSelector] = useState(false);
  const user = useAuthStore(s => s.user);
  const { data: staff } = useStaff();
  const doctors = (staff ?? []).filter(s => s.role === 'DOCTOR');

  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [patientName, setPatientName] = useState('');
  const [doctorId, setDoctorId] = useState(user?.role === 'DOCTOR' ? user.id : '');
  const [type, setType] = useState<ImagingType>('PANORAMIC');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [takenAt, setTakenAt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [remark, setRemark] = useState('');

  const handleSelectPatient = (patient: { id: string; name: string }) => {
    setPatientId(patient.id);
    setPatientName(patient.name);
  };

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setImageUrl('');
      setRemark('');
    }
  }, [open]);

  async function handleSubmit() {
    if (!patientId || !title || !imageUrl) return;
    await onCreate({
      patientId,
      doctorId: doctorId || undefined,
      type,
      title,
      description: description || undefined,
      imageUrl,
      takenAt: new Date(takenAt).toISOString(),
      remark: remark || undefined,
    });
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>添加影像</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className='space-y-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-1.5'>
                <Label>患者 *</Label>
                <Button
                  variant='outline'
                  className='w-full justify-start'
                  onClick={() => setOpenSelector(true)}
                  disabled={openSelector}
                >
                  <User className='w-4 h-4 mr-2' />
                  {patientName || '请选择患者'}
                </Button>
              </div>
            <div className='space-y-1.5'>
              <Label htmlFor="imaging-doctor">拍摄医生</Label>
              <Select id="imaging-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value=''>不指定</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              <Label htmlFor="imaging-type">影像类型 *</Label>
              <Select
                id="imaging-type"
                value={type}
                onChange={e => setType(e.target.value as ImagingType)}
              >
                <option value='PANORAMIC'>全景片</option>
                <option value='PERIAPICAL'>根尖片</option>
                <option value='BITEWING'>咬翼片</option>
                <option value='CBCT'>锥形束CT</option>
                <option value='INTRAORAL'>口内照片</option>
                <option value='EXTRAORAL'>口外照片</option>
                <option value='OTHER'>其他</option>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor="imaging-taken-at">拍摄日期</Label>
              <Input
                id="imaging-taken-at"
                type='datetime-local'
                value={takenAt}
                onChange={e => setTakenAt(e.target.value)}
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="imaging-title">标题 *</Label>
            <Input
              id="imaging-title"
              placeholder='如：术前全景片'
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="imaging-url">影像URL *</Label>
            <Input
              id="imaging-url"
              placeholder='请输入影像文件URL'
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              支持外部链接或本地路径（如 http://example.com/x-ray.jpg）
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="imaging-description">描述</Label>
            <Textarea
              id="imaging-description"
              placeholder='影像描述（可选）'
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor="imaging-remark">备注</Label>
            <Input
              id="imaging-remark"
              placeholder='备注（可选）'
              value={remark}
              onChange={e => setRemark(e.target.value)}
            />
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <Button variant='outline' onClick={onClose}>
              <X className='w-4 h-4 mr-2' />
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={!patientId || !title || !imageUrl}>
              <Check className='w-4 h-4 mr-2' />
              添加影像
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
      <PatientSelector
        open={openSelector}
        onClose={() => setOpenSelector(false)}
        onSelect={handleSelectPatient}
        title="选择患者"
      />
    </>
  );
}
