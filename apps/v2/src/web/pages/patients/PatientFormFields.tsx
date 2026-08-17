import { GENDER_LABELS, PREFERRED_CONTACT_LABELS, SOURCE_LABELS } from './patients-constants';
import type { PatientForm } from './patients-types';

export function PatientFormFields({
  form,
  update,
}: {
  form: PatientForm;
  update: (patch: Partial<PatientForm>) => void;
}) {
  return (
    <>
      <label>
        患者编号
        <input value={form.code} onChange={(event) => update({ code: event.target.value })} />
      </label>
      <label>
        姓名
        <input value={form.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        性别
        <select value={form.gender} onChange={(event) => update({ gender: event.target.value })}>
          {Object.entries(GENDER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        手机号
        <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} />
      </label>
      <label>
        微信号
        <input value={form.wechatId} onChange={(event) => update({ wechatId: event.target.value })} />
      </label>
      <label>
        首选联系方式
        <select value={form.preferredContact} onChange={(event) => update({ preferredContact: event.target.value })}>
          {Object.entries(PREFERRED_CONTACT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        联系方式备注
        <textarea value={form.contactNote} onChange={(event) => update({ contactNote: event.target.value })} />
      </label>
      <label>
        出生日期
        <input type="date" value={form.birthDate} onChange={(event) => update({ birthDate: event.target.value })} />
      </label>
      <label>
        身份证号
        <input value={form.idCard} onChange={(event) => update({ idCard: event.target.value })} />
      </label>
      <label>
        地址
        <input value={form.address} onChange={(event) => update({ address: event.target.value })} />
      </label>
      <label>
        职业
        <input value={form.occupation} onChange={(event) => update({ occupation: event.target.value })} />
      </label>
      <label>
        来源
        <select value={form.source} onChange={(event) => update({ source: event.target.value })}>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        头像地址
        <input value={form.avatar} onChange={(event) => update({ avatar: event.target.value })} />
      </label>
      <label>
        过敏史（每行一条）
        <textarea value={form.allergies} onChange={(event) => update({ allergies: event.target.value })} />
      </label>
      <label>
        既往病史（每行一条）
        <textarea value={form.medicalHistory} onChange={(event) => update({ medicalHistory: event.target.value })} />
      </label>
      <label>
        用药史（每行一条）
        <textarea value={form.medicationHistory} onChange={(event) => update({ medicationHistory: event.target.value })} />
      </label>
      <label>
        全身疾病（每行一条）
        <textarea value={form.systemicDiseases} onChange={(event) => update({ systemicDiseases: event.target.value })} />
      </label>
      <label>
        标签（每行一条）
        <textarea value={form.tags} onChange={(event) => update({ tags: event.target.value })} />
      </label>
      <label>
        备注
        <textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={form.active} onChange={(event) => update({ active: event.target.checked })} />
        启用档案
      </label>
    </>
  );
}
