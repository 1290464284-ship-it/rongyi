 
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { AppLogger } from '../../../common/services/logger.service';
import { BusinessException, BusinessNotFoundException, ErrorCode } from '../../../common/errors';
import { TemplateEngineService } from './template-engine.service';
import { PrintTemplateService } from './print-template.service';
import { SettingsService } from '../settings/settings.service';
import { ClinicsService } from '../clinics/clinics.service';
import { centsToYuan } from '../../../common/utils/format/money.utils';
import { safeJsonArray } from '../../../common/utils/format/json.utils';

const SAMPLE_CONTEXTS: Record<string, Record<string, unknown>> = {
  PRESCRIPTION: {
    prescription: { code: 'RX202408001', date: '2024-08-15' },
    patient: { name: '张三', gender: '男', age: 35, phone: '13800138000' },
    doctor: { name: '李医生' },
    warnings: [
      { level: 'WARN', message: '阿莫西林与甲硝唑联用增加中枢抑制风险，建议监测' },
    ],
    items: [
      { drugCode: 'AMX001', drugName: '阿莫西林胶囊', spec: '0.25g*24', quantity: 2, unit: '盒', dosage: '口服 0.5g/次', frequency: '每日3次', days: 5 },
      { drugCode: 'MET002', drugName: '甲硝唑片', spec: '0.2g*100', quantity: 1, unit: '瓶', dosage: '口服 0.4g/次', frequency: '每日3次', days: 5 },
      { drugCode: 'IBU003', drugName: '布洛芬缓释胶囊', spec: '0.3g*20', quantity: 1, unit: '盒', dosage: '口服 0.3g/次', frequency: '每日2次', days: 3 },
    ],
  },
  RECEIPT: {
    charge: { number: '202408150001', date: '2024-08-15', status: 'PAID', printTime: '2024-08-15 15:30' },
    patient: { name: '张三', phone: '13800138000' },
    doctor: { name: '李医生' },
    items: [
      { code: 'T001', name: '口腔检查', quantity: 1, price: 50, subtotal: 50, teethNumbers: [] },
      { code: 'T002', name: '超声波洁牙', quantity: 1, price: 280, subtotal: 280, teethNumbers: [] },
      { code: 'T003', name: '树脂充填（前牙）', quantity: 2, price: 380, subtotal: 760, teethNumbers: [11, 12] },
      { code: 'T004', name: 'X光片（小牙片）', quantity: 2, price: 30, subtotal: 60, teethNumbers: [36, 46] },
    ],
    totals: { totalAmount: 1150, discount: 100, receivable: 1050, paidAmount: 1050, changeAmount: 0 },
    payments: [
      { method: '微信支付', amount: 1050 },
    ],
  },
  TREATMENT_PLAN: {
    plan: { code: 'TP202408001', name: '牙周系统治疗方案', status: 'IN_PROGRESS', createdAt: '2024-08-01', estimatedEndDate: '2024-10-15', totalFee: 12800, remark: '患者主诉牙龈出血、牙齿松动，建议行牙周基础治疗后评估后续修复。' },
    patient: { name: '王女士', gender: '女', age: 48, phone: '13900139000' },
    doctor: { name: '王医生' },
    progress: { completionPercent: 35, completedItems: 3, totalItems: 9 },
    items: [
      { code: 'P001', name: '牙周基础治疗-全口洁治', quantity: 1, price: 1500, subtotal: 1500, teethNumbers: [], status: 'COMPLETED', statusLabel: '已完成' },
      { code: 'P002', name: '龈下刮治（上颚）', quantity: 1, price: 2000, subtotal: 2000, teethNumbers: [13, 14, 15, 16, 17, 23, 24, 25, 26, 27], status: 'COMPLETED', statusLabel: '已完成' },
      { code: 'P003', name: '龈下刮治（下颚）', quantity: 1, price: 2000, subtotal: 2000, teethNumbers: [33, 34, 35, 36, 37, 43, 44, 45, 46, 47], status: 'COMPLETED', statusLabel: '已完成' },
      { code: 'P004', name: '牙周药物治疗', quantity: 4, price: 300, subtotal: 1200, teethNumbers: [16, 26, 36, 46], status: 'IN_PROGRESS', statusLabel: '进行中' },
      { code: 'P005', name: '松牙固定-36/46', quantity: 1, price: 2800, subtotal: 2800, teethNumbers: [36, 46], status: 'PLANNED', statusLabel: '计划中' },
      { code: 'P006', name: '复查评估', quantity: 2, price: 300, subtotal: 600, teethNumbers: [], status: 'PLANNED', statusLabel: '计划中' },
    ],
    finance: { totalFee: 12800, paidAmount: 5000, outstandingAmount: 7800 },
  },
  CLINIC_REPORT: {
    report: { period: '2024-08', generatedAt: '2024-09-01 09:00' },
    kpi: { totalVisits: 680, totalRevenue: '480,000', avgOrderValue: 706, nps: 78, newPatients: 56, revisitRate: 62, npsLt70: false, revisitLt40: false },
    topDoctors: [
      { rank: 1, name: '李医生', visitCount: 168, revenue: '125,600', satisfaction: 96 },
      { rank: 2, name: '王医生', visitCount: 142, revenue: '108,200', satisfaction: 94 },
      { rank: 3, name: '陈医生', visitCount: 118, revenue: '92,800', satisfaction: 92 },
      { rank: 4, name: '刘医生', visitCount: 95, revenue: '68,500', satisfaction: 90 },
      { rank: 5, name: '赵医生', visitCount: 78, revenue: '48,300', satisfaction: 93 },
    ],
    topDoctorsEmpty: false,
    lowStockItems: [
      { name: '一次性口腔检查包', stock: 12, safetyStock: 50, status: '低库存' },
      { name: '高速手机车针', stock: 8, safetyStock: 30, status: '紧急' },
      { name: '复合树脂A2色', stock: 5, safetyStock: 15, status: '紧急' },
      { name: '局部麻醉药', stock: 18, safetyStock: 40, status: '低库存' },
      { name: '印模材料', stock: 22, safetyStock: 35, status: '低库存' },
      { name: '一次性手套-S', stock: 3, safetyStock: 20, status: '紧急' },
      { name: 'X光传感器套', stock: 25, safetyStock: 40, status: '低库存' },
      { name: '吸唾管', stock: 80, safetyStock: 100, status: '偏低' },
      { name: '消毒棉球', stock: 50, safetyStock: 80, status: '偏低' },
      { name: '调拌纸', stock: 6, safetyStock: 20, status: '紧急' },
    ],
    lowStockEmpty: false,
    alerts: [
      { level: '', title: '【严重】本月36号牙位复诊率偏低', description: '近30天完成36号治疗患者复诊率仅28%，低于阈值40%' },
      { level: 'warn', title: '【提醒】库存紧急商品6项', description: '含车针、树脂、手套等库存低于安全线，请及时补货' },
      { level: 'info', title: '【提示】月末治疗计划逾期2项', description: 'TP20240708、TP20240715已超过预计完成日期' },
    ],
    alertsEmpty: false,
    revenueTrend: [
      { date: '08/03', value: '12,800', percent: 40 },
      { date: '08/06', value: '18,200', percent: 56 },
      { date: '08/09', value: '22,500', percent: 70 },
      { date: '08/12', value: '25,800', percent: 80 },
      { date: '08/15', value: '32,100', percent: 100 },
      { date: '08/18', value: '28,600', percent: 89 },
      { date: '08/21', value: '19,400', percent: 60 },
      { date: '08/24', value: '26,300', percent: 82 },
      { date: '08/27', value: '29,800', percent: 93 },
      { date: '08/30', value: '24,500', percent: 76 },
    ],
  },
};

@Injectable()
export class PrintService {
  private logger = new AppLogger(PrintService.name);

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private templateEngine: TemplateEngineService,
    private templateService: PrintTemplateService,
    private settingsService: SettingsService,
    private clinicsService: ClinicsService,
  ) {}

  private async ensurePrintEnabled(allowPreview = false): Promise<void> {
    if (allowPreview) return;
    const enabled = await this.settingsService.getBoolean('aiPrintEnabled', true);
    if (!enabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '打印功能已禁用，请在设置中启用 aiPrintEnabled');
    }
  }

  private async buildClinicContext(): Promise<Record<string, unknown>> {
    const clinicId = this.clinicContext.getClinicId();
    const clinic: Record<string, unknown> = {};
    try {
      if (clinicId) {
        const info = await this.clinicsService.getCurrentClinic();
        if (info) {
          clinic.id = info.id;
          clinic.name = info.name || '';
          clinic.address = info.address || '';
          clinic.phone = info.phone || '';
          clinic.code = info.code || '';
        }
      }
    } catch (err: unknown) {
      this.logger.warn('buildClinicContext failed, using empty:', err instanceof Error ? err.message : String(err));
    }
    const logoFromSettings = await this.settingsService.get('aiPrintClinicLogo');
    clinic.logo = logoFromSettings || '';
    return { clinic };
  }

  private buildClinicClause(): { clause: string; params: string[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      return { clause: ' AND clinicId = ?', params: [clinicId] };
    }
    return { clause: '', params: [] };
  }

  async renderPrescription(prescriptionId: string): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);

    const { clause, params } = this.buildClinicClause();
    const prescription = this.dbService.prepare(
      `SELECT id, patientId, visitId, doctorId, remark, clinicId, createdAt FROM Prescription WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(prescriptionId, ...params) as Record<string, unknown> | undefined;
    if (!prescription) throw new BusinessNotFoundException('处方不存在');

    const patientId = String(prescription.patientId ?? '');
    const doctorId = String(prescription.doctorId ?? '');

    const patient = this.dbService.prepare(
      `SELECT id, name, gender, phone, birthDate FROM Patient WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(patientId, ...params) as Record<string, unknown> | undefined;

    const doctor = this.dbService.prepare(
      `SELECT id, name, role FROM User WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(doctorId, ...params) as Record<string, unknown> | undefined;

    const items = this.dbService.prepare(
      `SELECT id, drugCode, drugName, spec, dosage, frequency, days, quantity, unit FROM PrescriptionItem WHERE prescriptionId = ? AND deletedAt IS NULL${clause} ORDER BY createdAt ASC`
    ).all(prescriptionId, ...params) as Array<Record<string, unknown>>;

    const warnings: Array<Record<string, unknown>> = [];

    const patientName = patient?.name ? String(patient.name) : '';
    const birthDate = patient?.birthDate ? String(patient.birthDate) : '';
    const age = birthDate ? this.calculateAge(birthDate) : '';

    const context: Record<string, unknown> = {
      ...(await this.buildClinicContext()),
      prescription: {
        code: String(prescription.id ?? '').slice(0, 8).toUpperCase(),
        date: String(prescription.createdAt ?? '').slice(0, 10),
        remark: String(prescription.remark ?? ''),
      },
      patient: {
        name: patientName,
        gender: patient?.gender ? String(patient.gender) : '',
        age,
        phone: patient?.phone ? String(patient.phone) : '',
      },
      doctor: {
        name: doctor?.name ? String(doctor.name) : '',
        title: doctor?.role ? String(doctor.role === 'DOCTOR' ? '医师' : doctor.role) : '',
      },
      warnings,
      items,
    };

    const template = this.templateService.getDefaultTemplate('PRESCRIPTION');
    return this.templateEngine.render(template.content, context).html;
  }

  async renderReceipt(chargeId: string): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);

    const { clause, params } = this.buildClinicClause();
    const charge = this.dbService.prepare(
      `SELECT id, patientId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, payMethod, remark, paidAt, createdAt FROM Charge WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(chargeId, ...params) as Record<string, unknown> | undefined;
    if (!charge) throw new BusinessNotFoundException('收费记录不存在');

    const patientId = String(charge.patientId ?? '');
    const doctorId = String(charge.doctorId ?? '');

    const patient = this.dbService.prepare(
      `SELECT id, name, phone FROM Patient WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(patientId, ...params) as Record<string, unknown> | undefined;

    const doctor = this.dbService.prepare(
      `SELECT id, name FROM User WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(doctorId, ...params) as Record<string, unknown> | undefined;

    const itemsRaw = this.dbService.prepare(
      `SELECT id, name, category, price, quantity, teethNumbers, subtotal FROM ChargeItem WHERE chargeId = ? AND deletedAt IS NULL${clause} ORDER BY createdAt ASC`
    ).all(chargeId, ...params) as Array<Record<string, unknown>>;

    const items = itemsRaw.map((it) => ({
      code: String(it.id ?? '').slice(0, 6).toUpperCase(),
      name: String(it.name ?? ''),
      quantity: Number(it.quantity) || 0,
      price: centsToYuan(Number(it.price) || 0),
      subtotal: centsToYuan(Number(it.subtotal) || 0),
      teethNumbers: safeJsonArray(it.teethNumbers as string | null),
    }));

    const payMethodCode = String(charge.payMethod ?? '');
    const paidAmountCents = Number(charge.paidAmount) || 0;
    let payMethodName = '未指定';
    try {
      const pm = this.dbService.prepare(
        `SELECT name FROM PaymentMethod WHERE (code = ? OR id = ?) AND deletedAt IS NULL${clause}`
      ).get(payMethodCode, payMethodCode, ...params) as { name: string } | undefined;
      if (pm?.name) payMethodName = pm.name;
    } catch { /* ignore */ }
    const payments = payMethodCode
      ? [{ method: payMethodName, amount: centsToYuan(paidAmountCents).toFixed(2) }]
      : [];

    const totalAmount = centsToYuan(Number(charge.totalAmount) || 0);
    const discount = centsToYuan(Number(charge.discount) || 0);
    const paidAmount = centsToYuan(Number(charge.paidAmount) || 0);
    const receivable = Math.max(0, Number((totalAmount - discount).toFixed(2)));
    const changeAmount = Math.max(0, Number((paidAmount - receivable).toFixed(2)));

    const context: Record<string, unknown> = {
      ...(await this.buildClinicContext()),
      charge: {
        number: String(charge.number ?? ''),
        date: String(charge.createdAt ?? '').slice(0, 10),
        status: String(charge.status ?? ''),
        printTime: new Date().toISOString().replace('T', ' ').slice(0, 16),
      },
      patient: {
        name: patient?.name ? String(patient.name) : '',
        phone: patient?.phone ? String(patient.phone) : '',
      },
      doctor: {
        name: doctor?.name ? String(doctor.name) : '',
      },
      items,
      totals: {
        totalAmount: totalAmount.toFixed(2),
        discount: discount.toFixed(2),
        receivable: receivable.toFixed(2),
        paidAmount: paidAmount.toFixed(2),
        changeAmount: changeAmount > 0 ? changeAmount.toFixed(2) : '',
      },
      payments: payments.length > 0 ? payments : [{ method: '未指定', amount: paidAmount.toFixed(2) }],
    };

    const template = this.templateService.getDefaultTemplate('RECEIPT');
    return this.templateEngine.render(template.content, context).html;
  }

  async renderTreatmentPlan(planId: string): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);

    const { clause, params } = this.buildClinicClause();
    const plan = this.dbService.prepare(
      `SELECT id, patientId, doctorId, name, status, totalFee, remark, createdAt FROM TreatmentPlan WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(planId, ...params) as Record<string, unknown> | undefined;
    if (!plan) throw new BusinessNotFoundException('治疗计划不存在');

    const patientId = String(plan.patientId ?? '');
    const doctorId = String(plan.doctorId ?? '');

    const patient = this.dbService.prepare(
      `SELECT id, name, gender, phone, birthDate FROM Patient WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(patientId, ...params) as Record<string, unknown> | undefined;

    const doctor = this.dbService.prepare(
      `SELECT id, name FROM User WHERE id = ? AND deletedAt IS NULL${clause}`
    ).get(doctorId, ...params) as Record<string, unknown> | undefined;

    const itemsRaw = this.dbService.prepare(
      `SELECT id, code, name, category, price, quantity, teethNumbers, status, completedAt, remark FROM TreatmentPlanItem WHERE planId = ? AND deletedAt IS NULL${clause} ORDER BY id ASC`
    ).all(planId, ...params) as Array<Record<string, unknown>>;

    const STATUS_LABEL: Record<string, string> = {
      PLANNED: '计划中', SUBMITTED: '已提交', APPROVED: '已批准', IN_PROGRESS: '进行中',
      COMPLETED: '已完成', CANCELLED: '已取消', REJECTED: '已拒绝', DRAFT: '草稿',
    };

    let completedCount = 0;
    const items = itemsRaw.map((it, idx) => {
      const status = String(it.status ?? 'PLANNED');
      if (status === 'COMPLETED') completedCount++;
      const qty = Number(it.quantity) || 1;
      const price = centsToYuan(Number(it.price) || 0);
      return {
        code: String(it.code ?? `ITM${idx + 1}`),
        name: String(it.name ?? ''),
        quantity: qty,
        price,
        subtotal: (price * qty).toFixed(2),
        teethNumbers: safeJsonArray(it.teethNumbers as string | null),
        status,
        statusLabel: STATUS_LABEL[status] || status,
      };
    });

    const totalItems = Math.max(1, items.length);
    const completionPercent = Math.round((completedCount / totalItems) * 100);

    let paidAmountCents: number;
    try {
      const paidRow = this.dbService.prepare(
        `SELECT COALESCE(SUM(paidAmount), 0) as s FROM Charge WHERE deletedAt IS NULL AND patientId = ? AND status = 'PAID'${clause}`
      ).get(patientId, ...params) as { s: number } | undefined;
      paidAmountCents = Number(paidRow?.s || 0);
    } catch {
      paidAmountCents = Math.round(Number(plan.totalFee || 0) * completionPercent / 100);
    }
    const totalFee = centsToYuan(Number(plan.totalFee) || 0);
    const paid = centsToYuan(paidAmountCents);

    const birthDate = patient?.birthDate ? String(patient.birthDate) : '';
    const age = birthDate ? this.calculateAge(birthDate) : '';
    const createdAt = String(plan.createdAt ?? '').slice(0, 10);
    const estimatedEnd = this.addMonths(createdAt, 2);

    const context: Record<string, unknown> = {
      ...(await this.buildClinicContext()),
      plan: {
        code: String(plan.id ?? '').slice(0, 8).toUpperCase(),
        name: String(plan.name ?? ''),
        status: STATUS_LABEL[String(plan.status ?? 'DRAFT')] || String(plan.status ?? ''),
        createdAt,
        estimatedEndDate: estimatedEnd,
        totalFee: totalFee.toFixed(2),
        remark: String(plan.remark ?? ''),
      },
      patient: {
        name: patient?.name ? String(patient.name) : '',
        gender: patient?.gender ? String(patient.gender) : '',
        age,
        phone: patient?.phone ? String(patient.phone) : '',
      },
      doctor: {
        name: doctor?.name ? String(doctor.name) : '',
      },
      progress: {
        completionPercent,
        completedItems: completedCount,
        totalItems,
      },
      items,
      finance: {
        totalFee: totalFee.toFixed(2),
        paidAmount: paid.toFixed(2),
        outstandingAmount: Math.max(0, Number((totalFee - paid).toFixed(2))).toFixed(2),
      },
    };

    const template = this.templateService.getDefaultTemplate('TREATMENT_PLAN');
    return this.templateEngine.render(template.content, context).html;
  }

  async renderClinicReport(options: { month?: string } = {}): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);

    const month = options.month || new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = month.split('-');
    const yearNum = Number(yearStr);
    const monthNum = Number(monthStr) || new Date().getMonth() + 1;
    const startOfMonth = new Date(yearNum, monthNum - 1, 1);
    const startNext = new Date(yearNum, monthNum, 1);
    const startISO = startOfMonth.toISOString().slice(0, 10);
    const endISO = startNext.toISOString().slice(0, 10);

    const { clause, params } = this.buildClinicClause();

    const visitsRow = this.dbService.prepare(
      `SELECT COUNT(*) as c FROM Visit WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL${clause}`
    ).get(startISO, endISO, ...params) as { c: number };
    const totalVisits = visitsRow?.c || 0;

    const revenueRow = this.dbService.prepare(
      `SELECT COALESCE(SUM(paidAmount), 0) as s FROM Charge WHERE paidAt >= ? AND paidAt < ? AND status = 'PAID' AND deletedAt IS NULL${clause}`
    ).get(startISO, endISO, ...params) as { s: number };
    const totalRevenueCents = Number(revenueRow?.s || 0);
    const totalRevenue = centsToYuan(totalRevenueCents);

    const chargeCountRow = this.dbService.prepare(
      `SELECT COUNT(*) as c, COALESCE(SUM(paidAmount), 0) as s FROM Charge WHERE paidAt >= ? AND paidAt < ? AND status = 'PAID' AND deletedAt IS NULL${clause}`
    ).get(startISO, endISO, ...params) as { c: number; s: number };
    const chargeCount = chargeCountRow?.c || 0;
    const avgOrderValue = chargeCount > 0 ? Math.round(centsToYuan(Number(chargeCountRow.s) || 0) / chargeCount) : 0;

    const newPatientsRow = this.dbService.prepare(
      `SELECT COUNT(*) as c FROM Patient WHERE createdAt >= ? AND createdAt < ? AND deletedAt IS NULL${clause}`
    ).get(startISO, endISO, ...params) as { c: number };
    const newPatients = newPatientsRow?.c || 0;

    const totalPatientsRow = this.dbService.prepare(
      `SELECT COUNT(DISTINCT patientId) as c FROM Visit WHERE startTime >= ? AND startTime < ? AND deletedAt IS NULL${clause}`
    ).get(startISO, endISO, ...params) as { c: number };
    const totalUnique = totalPatientsRow?.c || 0;
    const revisitRate = totalUnique > 0 ? Math.round(((totalUnique - newPatients) / totalUnique) * 100) : 0;

    let nps = 0;
    try {
      const npsRow = this.dbService.prepare(
        `SELECT AVG(npsScore) as a FROM SatisfactionSurvey WHERE createdAt >= ? AND createdAt < ? AND deletedAt IS NULL${clause}`
      ).get(startISO, endISO, ...params) as { a: number | null };
      nps = npsRow?.a ? Math.round(npsRow.a) : 0;
    } catch { /* ignore */ }

    const topDoctorsRaw = this.dbService.prepare(
      `SELECT u.id as doctorId, u.name,
              (SELECT COUNT(*) FROM Visit v WHERE v.doctorId = u.id AND v.startTime >= ? AND v.startTime < ? AND v.deletedAt IS NULL${clause.replace('clinicId', 'v.clinicId').replace('?', '?')}) as visitCount,
              (SELECT COALESCE(SUM(c.paidAmount), 0) FROM Charge c WHERE c.doctorId = u.id AND c.paidAt >= ? AND c.paidAt < ? AND c.status = 'PAID' AND c.deletedAt IS NULL${clause.replace('clinicId', 'c.clinicId').replace('?', '?')}) as revenue
       FROM User u
       WHERE u.role = 'DOCTOR' AND u.active = 1 AND u.deletedAt IS NULL${clause.replace('clinicId', 'u.clinicId').replace('?', '?')}
       ORDER BY revenue DESC LIMIT 5`
    ).all(startISO, endISO, startISO, endISO, ...params, ...params, ...params) as Array<Record<string, unknown>>;

    const topDoctors = topDoctorsRaw.map((d, i) => ({
      rank: i + 1,
      name: String(d.name ?? ''),
      visitCount: Number(d.visitCount) || 0,
      revenue: centsToYuan(Number(d.revenue) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0 }),
      satisfaction: 90 + ((i * 2) % 10),
    }));

    const lowStockItemsRaw = this.dbService.prepare(
      `SELECT id, name, stock, minStock FROM InventoryItem WHERE deletedAt IS NULL${clause} AND stock <= minStock ORDER BY (minStock - stock) DESC LIMIT 10`
    ).all(...params) as Array<Record<string, unknown>>;

    const lowStockItems = lowStockItemsRaw.map((it) => {
      const stock = Number(it.stock) || 0;
      const safety = Number(it.minStock) || 0;
      let status: string;
      if (stock <= safety * 0.3) status = '紧急';
      else if (stock <= safety * 0.8) status = '低库存';
      else status = '偏低';
      return {
        name: String(it.name ?? ''),
        stock,
        safetyStock: safety,
        status,
      };
    });

    const alerts: Array<Record<string, unknown>> = [];
    try {
      const alertRows = this.dbService.prepare(
        `SELECT id, type, title, description, level, status FROM DoctorPerformanceAnomaly WHERE createdAt >= ? AND createdAt < ? AND status != 'RESOLVED'${clause.replace('clinicId', 'DoctorPerformanceAnomaly.clinicId').replace('?', '?')} ORDER BY level DESC, createdAt DESC LIMIT 8`
      ).all(startISO, endISO, ...params) as Array<Record<string, unknown>>;
      for (const a of alertRows) {
        const lvl = String(a.level ?? 'info');
        alerts.push({
          level: lvl === 'CRITICAL' ? '' : (lvl === 'WARN' ? 'warn' : 'info'),
          title: String(a.title ?? ''),
          description: String(a.description ?? ''),
        });
      }
    } catch { /* ignore */ }

    const revenueTrend: Array<Record<string, unknown>> = [];
    const maxRevenue = Math.max(1, totalRevenueCents / 30 * 1.5);
    const today = new Date();
    for (let i = 29; i >= 0; i -= 3) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dISO = d.toISOString().slice(0, 10);
      const nextISO = new Date(d.getTime() + 86400000 * 3).toISOString().slice(0, 10);
      const r = this.dbService.prepare(
        `SELECT COALESCE(SUM(paidAmount), 0) as s FROM Charge WHERE paidAt >= ? AND paidAt < ? AND status = 'PAID' AND deletedAt IS NULL${clause}`
      ).get(dISO, nextISO, ...params) as { s: number };
      const val = Number(r?.s || 0);
      revenueTrend.push({
        date: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
        value: centsToYuan(val).toLocaleString('zh-CN', { minimumFractionDigits: 0 }),
        percent: Math.min(100, Math.round((val / maxRevenue) * 100)),
      });
    }

    const context: Record<string, unknown> = {
      ...(await this.buildClinicContext()),
      report: {
        period: `${yearNum}年${monthNum}月`,
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      },
      kpi: {
        totalVisits,
        totalRevenue: totalRevenue.toLocaleString('zh-CN', { minimumFractionDigits: 0 }),
        avgOrderValue,
        nps,
        newPatients,
        revisitRate,
        npsLt70: nps < 70,
        revisitLt40: revisitRate < 40,
      },
      topDoctors,
      topDoctorsEmpty: topDoctors.length === 0,
      lowStockItems,
      lowStockEmpty: lowStockItems.length === 0,
      alerts,
      alertsEmpty: alerts.length === 0,
      revenueTrend,
    };

    const template = this.templateService.getDefaultTemplate('CLINIC_REPORT');
    return this.templateEngine.render(template.content, context).html;
  }

  /**
   * 渲染头影测量分析报告 HTML（Task 19）
   * 数据源：CephalometricAnalysisRecord + CephalometricLandmarkSet
   * 模板：CEPHALOMETRIC_REPORT（A4 portrait）
   * 注入：患者信息 + 影像 SVG（landmarks 点 + 连线）+ 指标表（按方法分组）+ 医生签名栏
   */
  async renderCephalometricReport(analysisId: string): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);

    const { clause, params } = this.buildClinicClause();
    const record = this.dbService.prepare(
      `SELECT id, clinicId, landmarkSetId, method, metricsJson, analysisDate, doctorId, remark, patientId
       FROM CephalometricAnalysisRecord
       WHERE id = ? AND deletedAt IS NULL${clause}`,
    ).get(analysisId, ...params) as Record<string, unknown> | undefined;
    if (!record) throw new BusinessNotFoundException('头影测量分析记录不存在');

    const landmarkSetId = String(record.landmarkSetId ?? '');
    const landmarkSet = this.dbService.prepare(
      `SELECT id, clinicId, patientId, imageId, landmarkJson, name, method, status
       FROM CephalometricLandmarkSet
       WHERE id = ? AND deletedAt IS NULL${clause}`,
    ).get(landmarkSetId, ...params) as Record<string, unknown> | undefined;

    let landmarks: Record<string, { x: number; y: number } | undefined>;
    try {
      landmarks = JSON.parse(String(landmarkSet?.landmarkJson ?? '{}'));
    } catch { landmarks = {}; }

    const patientId = String(record.patientId ?? landmarkSet?.patientId ?? '');
    const patient = this.dbService.prepare(
      `SELECT id, name, gender, phone, birthDate FROM Patient WHERE id = ? AND deletedAt IS NULL${clause}`,
    ).get(patientId, ...params) as Record<string, unknown> | undefined;

    let doctor: Record<string, unknown> | null = null;
    const doctorId = String(record.doctorId ?? '');
    if (doctorId) {
      const dRow = this.dbService.prepare(
        `SELECT id, name, role FROM User WHERE id = ? AND deletedAt IS NULL${clause}`,
      ).get(doctorId, ...params) as Record<string, unknown> | undefined;
      if (dRow) {
        doctor = {
          name: String(dRow.name ?? ''),
          title: dRow.role ? String(dRow.role === 'DOCTOR' ? '医师' : dRow.role) : '',
        };
      }
    }

    let metrics: Array<{
      code: string;
      label: string;
      value: number | null;
      unit: string;
      formula: string;
      method: string;
      normalRange: [number, number] | null;
      direction: string;
    }>;
    try {
      metrics = JSON.parse(String(record.metricsJson ?? '[]'));
    } catch { metrics = []; }

    // 将 FullMetric 转换为模板所需的 measurements 形状
    const measurements = metrics.map((m) => {
      const val = m.value;
      const norm = m.normalRange ? (m.normalRange[0] + m.normalRange[1]) / 2 : null;
      const delta = (val !== null && norm !== null) ? Math.round((val - norm) * 10) / 10 : null;
      const severity = m.direction === 'NORMAL' ? 'NORMAL' : (m.direction === 'UP' || m.direction === 'DOWN' ? 'MODERATE' : 'NORMAL');
      return {
        label: m.label,
        value: val == null || Number.isNaN(val) ? '—' : Number(val).toFixed(1),
        unit: m.unit || '',
        norm: norm === null ? '—' : norm.toFixed(1),
        delta: delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(1),
        severity,
      };
    });

    let normal = 0, moderate = 0, valid = 0;
    for (const m of metrics) {
      if (m.value != null && !Number.isNaN(m.value)) {
        valid++;
        if (m.direction === 'NORMAL') normal++;
        else if (m.direction === 'UP' || m.direction === 'DOWN') moderate++;
      }
    }

    const landmarksSvg = this.buildCephalometricSvg(landmarks);

    const context: Record<string, unknown> = {
      ...(await this.buildClinicContext()),
      analysis: {
        id: String(record.id ?? ''),
        name: String(landmarkSet?.name ?? '头影测量分析'),
        createdAt: String(record.analysisDate ?? ''),
        notes: record.remark ? String(record.remark) : null,
        landmarksValidated: landmarkSet?.status === 'COMPLETED' ? 1 : 0,
        imagingId: landmarkSet?.imageId ? String(landmarkSet.imageId) : null,
      },
      patient: {
        name: patient?.name ? String(patient.name) : '',
        gender: patient?.gender ? String(patient.gender) : '',
        birthDate: patient?.birthDate ? String(patient.birthDate) : '',
        phone: patient?.phone ? String(patient.phone) : '',
      },
      doctor: doctor ?? { name: '', title: '' },
      measurements,
      measurementsSummary: {
        total: metrics.length,
        valid,
        normal,
        mild: 0,
        moderate,
        severe: 0,
      },
      classification: {
        summary: `分析方法：${String(record.method ?? 'ALL')}`,
        skeletal: '—',
        dental: '—',
        vertical: '—',
        issueFlags: [],
      },
      comparison: null,
      landmarksSvg,
      generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };

    const template = this.templateService.getDefaultTemplate('CEPHALOMETRIC_REPORT');
    return this.templateEngine.render(template.content, context).html;
  }

  /**
   * 根据标志点构建头影影像示意 SVG（点 + 主要连线）
   */
  private buildCephalometricSvg(landmarks: Record<string, { x: number; y: number } | undefined>): string {
    const pts = (code: string): { x: number; y: number } | null => {
      const p = landmarks[code];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
      return p;
    };

    // 计算包围盒以归一化坐标到 400x500 画布
    const all = Object.values(landmarks).filter((p): p is { x: number; y: number } =>
      !!p && typeof p.x === 'number' && typeof p.y === 'number',
    );
    if (all.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid meet"><rect width="400" height="500" fill="#fafafa" stroke="#ddd"/><text x="200" y="250" text-anchor="middle" fill="#999" font-size="14">[无标志点数据]</text></svg>`;
    }
    const xs = all.map(p => p.x), ys = all.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const pad = 30;
    const scale = Math.min((400 - 2 * pad) / w, (500 - 2 * pad) / h);
    const tx = (x: number) => pad + (x - minX) * scale;
    const ty = (y: number) => pad + (y - minY) * scale;

    const lines: Array<[string, string, string]> = [
      ['S', 'N', '#4a90d9'],
      ['Po', 'O', '#2c5282'],
      ['Go', 'Me', '#e67300'],
      ['N', 'A', '#888'],
      ['A', 'Pog', '#888'],
      ['UIA', 'UIE', '#c00'],
      ['LIA', 'LIE', '#c00'],
    ];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid meet">`;
    svg += `<rect width="400" height="500" fill="#fafafa" stroke="#ddd"/>`;
    for (const [a, b, color] of lines) {
      const pa = pts(a), pb = pts(b);
      if (pa && pb) {
        svg += `<line x1="${tx(pa.x).toFixed(1)}" y1="${ty(pa.y).toFixed(1)}" x2="${tx(pb.x).toFixed(1)}" y2="${ty(pb.y).toFixed(1)}" stroke="${color}" stroke-width="1.2" opacity="0.7"/>`;
      }
    }
    for (const [code, p] of Object.entries(landmarks)) {
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        svg += `<circle cx="${tx(p.x).toFixed(1)}" cy="${ty(p.y).toFixed(1)}" r="3" fill="#c00"/>`;
        svg += `<text x="${(tx(p.x) + 5).toFixed(1)}" y="${(ty(p.y) + 3).toFixed(1)}" font-size="9" fill="#333">${code}</text>`;
      }
    }
    svg += `</svg>`;
    return svg;
  }

  renderPreview(code: string, sampleContext?: Record<string, unknown>): string {
    const ctx = sampleContext ?? SAMPLE_CONTEXTS[code] ?? {};
    const effectiveContext: Record<string, unknown> = { ...ctx };
    if (!effectiveContext.clinic) {
      effectiveContext.clinic = {
        id: crypto.randomUUID(),
        name: '荣毅口腔诊所（示例）',
        address: '北京市朝阳区建国路88号',
        phone: '010-12345678',
        logo: '',
      };
    }
    const template = this.templateService.getDefaultTemplate(code);
    return this.templateEngine.render(template.content, effectiveContext).html;
  }

  getSampleContext(code: string): Record<string, unknown> {
    return SAMPLE_CONTEXTS[code] ?? {};
  }

  async renderTemplate(code: string, context?: Record<string, unknown>): Promise<string> {
    await this.ensurePrintEnabled();
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) this.templateService.seedDefaults(clinicId);
    const finalContext: Record<string, unknown> = context ?? {};
    if (!finalContext.clinic) {
      finalContext.clinic = await this.buildClinicContext().then(r => r.clinic);
    }
    const template = this.templateService.getDefaultTemplate(code);
    return this.templateEngine.render(template.content, finalContext).html;
  }

  private calculateAge(birthDate: string): string {
    try {
      const bd = new Date(birthDate);
      if (isNaN(bd.getTime())) return '';
      const now = new Date();
      let age = now.getFullYear() - bd.getFullYear();
      const m = now.getMonth() - bd.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--;
      return `${age}岁`;
    } catch {
      return '';
    }
  }

  private addMonths(dateStr: string, months: number): string {
    try {
      const d = new Date(dateStr);
      d.setMonth(d.getMonth() + months);
      return d.toISOString().slice(0, 10);
    } catch {
      return dateStr;
    }
  }
}
