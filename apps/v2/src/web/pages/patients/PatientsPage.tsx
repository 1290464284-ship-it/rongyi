import { useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiRequest } from '../../lib/api';
import { CrudPage } from '../../components/CrudPage';
import { errorMessage } from '../../lib/messages';
import type { Page } from '../../lib/types';
import { patientColumns } from './patients-columns';
import { PatientFormFields } from './PatientFormFields';
import { joinLines, splitLines } from './patients-format';
import { emptyForm, type PatientForm, type PatientRow } from './patients-types';

export function PatientsPage() {
  const editingIdRef = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const urlSearch = searchParams.get('q') ?? undefined;
  return (
    <CrudPage<PatientRow, PatientForm>
      title="患者档案"
      createLabel="新建患者"
      emptyMessage="暂无患者"
      queryKey={['patients']}
      endpoint="/resources/patients"
      pageSize={20}
      cursorPagination
      initialSearch={urlSearch}
      initialForm={() => {
        editingIdRef.current = null;
        return { ...emptyForm };
      }}
      formFromRow={(row) => {
        editingIdRef.current = String(row.id);
        return {
          code: String(row.code ?? ''),
          name: String(row.name ?? ''),
          gender: String(row.gender ?? 'UNKNOWN'),
          phone: String(row.phone ?? ''),
          wechatId: String(row.wechatId ?? ''),
          preferredContact: String(row.preferredContact ?? 'PHONE'),
          contactNote: String(row.contactNote ?? ''),
          birthDate: String(row.birthDate ?? ''),
          idCard: String(row.idCard ?? ''),
          address: String(row.address ?? ''),
          occupation: String(row.occupation ?? ''),
          source: String(row.source ?? 'WALK_IN'),
          active: Boolean(row.active),
          avatar: String(row.avatar ?? ''),
          allergies: joinLines(row.allergies),
          medicalHistory: joinLines(row.medicalHistory),
          medicationHistory: joinLines(row.medicationHistory),
          systemicDiseases: joinLines(row.systemicDiseases),
          tags: joinLines(row.tags),
          remark: String(row.remark ?? ''),
        };
      }}
      toPayload={(form) => ({
        code: form.code,
        name: form.name,
        gender: form.gender,
        phone: form.phone,
        wechatId: form.wechatId || undefined,
        preferredContact: form.preferredContact,
        contactNote: form.contactNote || undefined,
        birthDate: form.birthDate || undefined,
        idCard: form.idCard || undefined,
        address: form.address || undefined,
        occupation: form.occupation || undefined,
        source: form.source,
        active: form.active,
        avatar: form.avatar || undefined,
        allergies: splitLines(form.allergies),
        medicalHistory: splitLines(form.medicalHistory),
        medicationHistory: splitLines(form.medicationHistory),
        systemicDiseases: splitLines(form.systemicDiseases),
        tags: splitLines(form.tags),
        remark: form.remark || undefined,
      })}
      onEditLoad={async (row) => {
        // 列表返回的 idCard 已按数据最小化掩码（保留尾号），编辑时从详情接口取完整值回填，
        // 避免把掩码写回库。
        const detail = await apiRequest<PatientRow>(`/resources/patients/${String(row.id)}`);
        return { idCard: String(detail.idCard ?? '') };
      }}
      onBeforeSubmit={async (form) => {
        // 兜底：详情加载失败/被跳过时掩码值会留在表单，提交前拦截防止掩码落库。
        if (String(form.idCard ?? '').includes('*')) {
          return '身份证号未完整加载，请关闭编辑框后重新打开编辑';
        }
        if (!form.phone && !form.code) return null;
        try {
          const duplicateCheck = await apiRequest<Page<PatientRow>>(
            `/resources/patients?page=1&pageSize=10&search=${encodeURIComponent(form.phone || form.code)}`,
          );
          const duplicate = duplicateCheck.items.find((row) => row.id !== editingIdRef.current && (
            (form.phone && String(row.phone ?? '') === form.phone) ||
            (form.code && String(row.code ?? '') === form.code)
          ));
          if (duplicate) return '手机号或患者编号已存在，请检查后重试';
          return null;
        } catch (error) {
          return errorMessage(error, '保存失败');
        }
      }}
      messages={{ create: '患者档案已创建', update: '患者档案已更新', delete: '患者档案已删除' }}
      errorMessages={{ create: '保存失败', update: '保存失败', delete: '删除失败' }}
      columns={patientColumns}
      canEdit
      canDelete
      searchable
      searchPlaceholder="搜索编号、姓名或手机号"
      searchAriaLabel="搜索患者"
      paged
      dialogTitle={(editing) => (editing ? '编辑患者' : '新建患者')}
      deleteTitle="删除患者"
      deleteMessage="确定删除该患者档案吗？"
      renderForm={(ctx) => (
        <PatientFormFields form={ctx.form} update={ctx.update} />
      )}
    />
  );
}
