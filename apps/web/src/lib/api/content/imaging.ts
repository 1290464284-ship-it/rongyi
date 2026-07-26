import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
import type { ImagingType } from '@dental/shared';

export type { ImagingType };

export interface Imaging {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  type: ImagingType;
  title?: string;
  filePath: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  takenAt?: string;
  width?: number;
  height?: number;
  size?: number;
  description?: string;
  remark?: string;
  doctorId?: string;
  doctorName?: string;
  doctor?: { id: string; name: string };
  createdAt: string;
  patient?: { id: string; name: string; code: string };
}

export interface CreateImagingDto {
  patientId: string;
  type: ImagingType;
  filePath: string;
  thumbnailPath?: string;
  width?: number;
  height?: number;
  size?: number;
  description?: string;
}

export interface UpdateImagingDto {
  type?: ImagingType;
  description?: string;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const IMAGING_TYPE_LABEL: Record<ImagingType, string> = {
  INTRAORAL: '口内片',
  PANORAMIC: '全景片',
  PERIAPICAL: '根尖片',
  BITEWING: '咬翼片',
  CEPHALOMETRIC: '头颅侧位片',
  CBCT: 'CBCT',
  EXTRAORAL: '口外片',
  OTHER: '其他',
};

export const IMAGING_TYPE_COLOR: Record<ImagingType, string> = {
  INTRAORAL: 'bg-blue-100 text-blue-700',
  PANORAMIC: 'bg-green-100 text-green-700',
  PERIAPICAL: 'bg-yellow-100 text-yellow-700',
  BITEWING: 'bg-pink-100 text-pink-700',
  CEPHALOMETRIC: 'bg-purple-100 text-purple-700',
  CBCT: 'bg-orange-100 text-orange-700',
  EXTRAORAL: 'bg-teal-100 text-teal-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

type ImagingQuery = { patientId?: string; type?: ImagingType; page?: number; pageSize?: number };

const crud = createPaginatedCrudHooks<Imaging, CreateImagingDto, UpdateImagingDto, ImagingQuery>('imaging', 'imaging');

export const useImagingList = crud.useList;
export const useCreateImaging = crud.useCreate;
export const useUpdateImaging = crud.useUpdate;
export const useDeleteImaging = crud.useDelete;
