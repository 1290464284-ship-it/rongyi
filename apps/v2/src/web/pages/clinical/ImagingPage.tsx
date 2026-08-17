import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, uploadFile } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import type { Page } from '../../lib/types';
import { CATEGORIES_LIST_PATH } from '../../imaging/constants';
import { imagingColumns } from '../../imaging/columns';
import { toLocalDatetime } from '../../imaging/format';
import { ImagingFormFields } from '../../imaging/ImagingFormFields';
import { emptyForm } from '../../imaging/types';
import type { ImagingRow, ImagingForm, ImagingCategoryRow } from '../../imaging/types';
import { ImagingCategoryPanel } from '../../imaging/ImagingCategoryPanel';
import { ImagingComparePanel } from '../../imaging/ImagingComparePanel';

export function ImagingPage() {
  const editingIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const categories = useQuery({
    queryKey: ['imaging-categories'],
    queryFn: () => apiRequest<Page<ImagingCategoryRow>>(CATEGORIES_LIST_PATH),
  });

  const categoryOptions = categories.data?.items ?? [];

  return (
    <>
      <CrudPage<ImagingRow, ImagingForm>
        title="影像管理"
        createLabel="上传影像"
        emptyMessage="暂无影像"
        queryKey={['imaging']}
        endpoint="/resources/imaging"
        paged
        initialForm={() => {
          editingIdRef.current = null;
          return { ...emptyForm };
        }}
        validate={(form) => (!form.patientId || !form.doctorId || !form.title ? '请选择患者、医生并填写影像标题' : null)}
        submitOverride={async ({ form, editing }) => {
          let uploadedFilename: string | null = null;
          // form.imageUrl 恒为 string（emptyForm 写 ''，formFromRow 写 String(row.imageUrl ?? '')），nullish 兜底为死代码，已删除。
          let imageUrl = form.imageUrl;
          if (file) {
            const uploaded = await uploadFile(file);
            uploadedFilename = uploaded.filename;
            imageUrl = uploaded.url;
          }
          const payload = {
            patientId: form.patientId,
            doctorId: form.doctorId,
            type: form.type || 'UNKNOWN',
            title: form.title,
            description: form.description || undefined,
            imageUrl,
            takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : undefined,
            remark: form.remark || undefined,
            categoryId: form.categoryId || undefined,
            phase: form.phase || undefined,
          };
          try {
            if (editing) {
              await apiRequest(`/resources/imaging/${editingIdRef.current}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
              });
            } else {
              await apiRequest('/resources/imaging', {
                method: 'POST',
                body: JSON.stringify(payload),
              });
            }
            setFile(null);
          } catch (error) {
            // 记录创建/更新失败时清理已上传的孤儿文件，避免占用配额和磁盘。
            if (uploadedFilename) {
              try {
                await apiRequest(`/files/${uploadedFilename}`, { method: 'DELETE' });
              } catch {
                // 清理失败不掩盖原始错误。
              }
            }
            throw error;
          }
        }}
        onAfterCreate={() => setFile(null)}
        onFormClose={() => setFile(null)}
        formFromRow={(row) => {
          editingIdRef.current = String(row.id);
          setFile(null);
          return {
            patientId: String(row.patientId ?? ''),
            doctorId: String(row.doctorId ?? ''),
            type: String(row.type ?? ''),
            title: String(row.title ?? ''),
            description: String(row.description ?? ''),
            takenAt: toLocalDatetime(row.takenAt),
            remark: String(row.remark ?? ''),
            categoryId: String(row.categoryId ?? ''),
            phase: String(row.phase ?? ''),
            imageUrl: String(row.imageUrl ?? ''),
          };
        }}
        messages={{ create: '影像记录已创建', update: '影像记录已更新', delete: '影像记录已删除' }}
        errorMessages={{ create: '创建影像失败', update: '更新影像失败', delete: '删除影像失败' }}
        columns={imagingColumns(categoryOptions)}
        canEdit
        canDelete
        renderForm={(ctx) => (
          <ImagingFormFields
            form={ctx.form}
            update={ctx.update}
            file={file}
            setFile={setFile}
            categories={categoryOptions}
          />
        )}
      />

      <ImagingCategoryPanel
        categories={categoryOptions}
        loading={categories.isLoading}
        error={categories.error}
        onRetry={() => void categories.refetch()}
        onChanged={() => categories.refetch()}
      />

      <ImagingComparePanel />
    </>
  );
}
