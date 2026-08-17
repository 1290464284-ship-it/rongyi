import type { AppointmentForm } from '../../appointments/types';

/** 编辑弹窗的初始表单（每次打开编辑前由 openEditAppointment 整体覆盖，此处仅作 useState 初值）。 */
export const emptyEditForm: AppointmentForm = {
  patientId: '',
  doctorId: '',
  chairId: '',
  type: 'REGULAR',
  purpose: '',
  tempPatientName: '',
  tempPatientPhone: '',
  startTime: '',
  endTime: '',
};
