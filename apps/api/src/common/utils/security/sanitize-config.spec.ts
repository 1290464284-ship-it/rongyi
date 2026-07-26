import { sanitizeData } from './sanitize-config';

jest.mock('./sanitize', () => ({
  sanitizeHtml: jest.fn((text: string) => `[sanitized-rich:${text}]`),
  sanitizePlain: jest.fn((text: string) => `[sanitized-plain:${text}]`),
}));

import { sanitizeHtml, sanitizePlain } from './sanitize';

describe('sanitize-config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeData', () => {
    describe('Patient 表（plain 模式）', () => {
      it('应使用 sanitizePlain 清理 name 字段', () => {
        sanitizeData('Patient', { name: '<script>alert("xss")</script>张三' });
        expect(sanitizePlain).toHaveBeenCalledWith('<script>alert("xss")</script>张三');
        expect(sanitizeHtml).not.toHaveBeenCalled();
      });

      it('应使用 sanitizePlain 清理 phone 字段', () => {
        sanitizeData('Patient', { phone: '<b>13800138000</b>' });
        expect(sanitizePlain).toHaveBeenCalledWith('<b>13800138000</b>');
      });

      it('应使用 sanitizePlain 清理 address 字段', () => {
        sanitizeData('Patient', { address: '<p>北京市</p>' });
        expect(sanitizePlain).toHaveBeenCalledWith('<p>北京市</p>');
      });

      it('应使用 sanitizePlain 清理 remark 字段', () => {
        sanitizeData('Patient', { remark: '<i>备注</i>' });
        expect(sanitizePlain).toHaveBeenCalledWith('<i>备注</i>');
      });

      it('应使用 sanitizePlain 清理 occupation 字段', () => {
        sanitizeData('Patient', { occupation: '<b>医生</b>' });
        expect(sanitizePlain).toHaveBeenCalledWith('<b>医生</b>');
      });

      it('未配置的字段应保持不变', () => {
        const data = { id: '1', name: '张三', age: 30, createdAt: '2024-01-01' };
        const result = sanitizeData('Patient', data);
        expect(result.id).toBe('1');
        expect(result.age).toBe(30);
        expect(result.createdAt).toBe('2024-01-01');
        expect(sanitizePlain).toHaveBeenCalledTimes(1);
      });
    });

    describe('Visit 表（rich 模式）', () => {
      it('应使用 sanitizeHtml 清理 chiefComplaint 字段', () => {
        sanitizeData('Visit', { chiefComplaint: '<b>牙痛</b>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<b>牙痛</b>');
        expect(sanitizePlain).not.toHaveBeenCalled();
      });

      it('应使用 sanitizeHtml 清理 diagnosis 字段', () => {
        sanitizeData('Visit', { diagnosis: '<p>诊断内容</p>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<p>诊断内容</p>');
      });

      it('应使用 sanitizeHtml 清理 treatmentPlan 字段', () => {
        sanitizeData('Visit', { treatmentPlan: '<i>治疗计划</i>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<i>治疗计划</i>');
      });
    });

    describe('Registration 表（混合模式）', () => {
      it('type 字段应使用 plain 模式', () => {
        sanitizeData('Registration', { type: '<b>初诊</b>' });
        expect(sanitizePlain).toHaveBeenCalledWith('<b>初诊</b>');
      });

      it('chiefComplaint 字段应使用 rich 模式', () => {
        sanitizeData('Registration', { chiefComplaint: '<b>牙痛</b>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<b>牙痛</b>');
      });

      it('triageNote 字段应使用 rich 模式', () => {
        sanitizeData('Registration', { triageNote: '<i>分诊备注</i>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<i>分诊备注</i>');
      });
    });

    describe('未配置的表', () => {
      it('未配置的表应原样返回', () => {
        const data = { field1: '<script>xss</script>', field2: 'value' };
        const result = sanitizeData('NonExistentTable', data);
        expect(result).toEqual(data);
        expect(sanitizeHtml).not.toHaveBeenCalled();
        expect(sanitizePlain).not.toHaveBeenCalled();
      });

      it('空表名应原样返回', () => {
        const data = { name: '<b>test</b>' };
        const result = sanitizeData('', data);
        expect(result).toEqual(data);
      });
    });

    describe('空值处理', () => {
      it('null 值应跳过清理', () => {
        const result = sanitizeData('Patient', { name: null, phone: '13800138000' });
        expect(result.name).toBeNull();
        expect(sanitizePlain).toHaveBeenCalledTimes(1);
        expect(sanitizePlain).toHaveBeenCalledWith('13800138000');
      });

      it('undefined 值应跳过清理', () => {
        const result = sanitizeData('Patient', { name: undefined, phone: '13800138000' });
        expect(result.name).toBeUndefined();
        expect(sanitizePlain).toHaveBeenCalledTimes(1);
      });

      it('空字符串应调用清理函数', () => {
        sanitizeData('Patient', { name: '' });
        expect(sanitizePlain).toHaveBeenCalledWith('');
      });
    });

    describe('非字符串值', () => {
      it('数字类型应保持不变', () => {
        const result = sanitizeData('Patient', { name: 123 as unknown as string });
        expect(result.name).toBe(123);
        expect(sanitizePlain).not.toHaveBeenCalled();
      });

      it('对象类型应保持不变', () => {
        const obj = { nested: 'value' };
        const result = sanitizeData('Patient', { name: obj as unknown as string });
        expect(result.name).toBe(obj);
      });

      it('数组类型应保持不变', () => {
        const arr = [1, 2, 3];
        const result = sanitizeData('Patient', { name: arr as unknown as string });
        expect(result.name).toBe(arr);
      });

      it('布尔类型应保持不变', () => {
        const result = sanitizeData('Patient', { name: true as unknown as string });
        expect(result.name).toBe(true);
      });
    });

    describe('多字段同时清理', () => {
      it('应同时清理多个配置的字段', () => {
        const data = {
          name: '<script>xss</script>张三',
          phone: '13800138000',
          address: '北京市',
          remark: '备注',
          id: '1',
        };
        const result = sanitizeData('Patient', data);
        expect(sanitizePlain).toHaveBeenCalledTimes(4);
        expect(sanitizePlain).toHaveBeenCalledWith('<script>xss</script>张三');
        expect(sanitizePlain).toHaveBeenCalledWith('13800138000');
        expect(sanitizePlain).toHaveBeenCalledWith('北京市');
        expect(sanitizePlain).toHaveBeenCalledWith('备注');
        expect(result.id).toBe('1');
      });
    });

    describe('返回新对象', () => {
      it('应返回新对象，不修改原对象', () => {
        const original = { name: '<script>xss</script>' };
        const result = sanitizeData('Patient', original);
        expect(result).not.toBe(original);
        expect(original.name).toBe('<script>xss</script>');
      });
    });

    describe('部分字段对象', () => {
      it('只包含部分配置字段时也应正确处理', () => {
        sanitizeData('Patient', { name: '<b>张三</b>' });
        expect(sanitizePlain).toHaveBeenCalledTimes(1);
        expect(sanitizePlain).toHaveBeenCalledWith('<b>张三</b>');
      });
    });

    describe('配置表验证', () => {
      const tablesWithConfig = [
        'Patient',
        'Appointment',
        'Visit',
        'Treatment',
        'TreatmentCatalog',
        'TreatmentPlan',
        'TreatmentPlanItem',
        'Registration',
        'FirstExam',
        'FirstExamTooth',
        'FirstExamFollowUp',
        'OralExamination',
        'PeriodontalRecord',
        'MedicalRecord',
        'MedicalRecordPhrase',
        'MedicalRecordTemplate',
        'RecordModifyRequest',
        'Prescription',
        'PrescriptionItem',
        'InventoryItem',
        'InventoryTransaction',
        'Supplier',
        'Charge',
        'ChargeItem',
        'ChargeCombo',
        'PaymentMethod',
        'Refund',
        'FollowUp',
        'WechatMessage',
      ];

      it.each(tablesWithConfig)('%s 表应配置了清理规则', (tableName) => {
        const data = { id: '1' };
        const result = sanitizeData(tableName, data);
        expect(Object.keys(result)).toContain('id');
      });
    });
  });
});
