import {
  createAdmin,
  createDoctor,
  createReceptionist,
  createPatients,
  createAppointments,
  createCharges,
  createInventoryItems,
  createMemberCards,
  resetPatientCodeCounter,
} from './factories';

describe('runSeed', () => {
  it('factory 函数应可用（runSeed 依赖 DB schema，在集成测试中验证）', () => {
    const clinicId = 'test-clinic';
    const admin = createAdmin(clinicId);
    expect(admin.role).toBe('BOSS');
  });
});

describe('Factory 函数', () => {
  const clinicId = 'test-clinic-id';

  describe('createAdmin', () => {
    it('应创建 BOSS 角色的管理员', () => {
      const admin = createAdmin(clinicId);
      expect(admin.role).toBe('BOSS');
      expect(admin.username).toBe('admin');
      expect(admin.clinicId).toBe(clinicId);
      expect(admin.active).toBe(1);
      expect(admin.id).toBeTruthy();
      expect(admin.passwordHash).toBeTruthy();
      expect(admin.createdAt).toBeTruthy();
      expect(admin.updatedAt).toBeTruthy();
    });

    it('应支持覆盖字段', () => {
      const admin = createAdmin(clinicId, { name: '超级管理员', username: 'superadmin' });
      expect(admin.name).toBe('超级管理员');
      expect(admin.username).toBe('superadmin');
    });
  });

  describe('createDoctor', () => {
    it('应创建 DOCTOR 角色的医生', () => {
      const doctor = createDoctor(clinicId);
      expect(doctor.role).toBe('DOCTOR');
      expect(doctor.clinicId).toBe(clinicId);
      expect(doctor.active).toBe(1);
      expect(doctor.id).toBeTruthy();
      expect(doctor.name).toBeTruthy();
    });
  });

  describe('createReceptionist', () => {
    it('应创建 RECEPTIONIST 角色的前台', () => {
      const receptionist = createReceptionist(clinicId);
      expect(receptionist.role).toBe('RECEPTIONIST');
      expect(receptionist.clinicId).toBe(clinicId);
      expect(receptionist.active).toBe(1);
    });
  });

  describe('createPatients', () => {
    it('应生成指定数量的患者', () => {
      const patients = createPatients(10, { clinicId });
      expect(patients).toHaveLength(10);
    });

    it('患者应有所有必需字段', () => {
      const patients = createPatients(1, { clinicId });
      const p = patients[0];

      expect(p.id).toBeTruthy();
      expect(p.code).toMatch(/^P\d{6}$/);
      expect(p.name).toBeTruthy();
      expect(p.gender).toMatch(/^(MALE|FEMALE)$/);
      expect(p.birthDate).toBeTruthy();
      expect(p.phone).toBeTruthy();
      expect(p.idCard).toBeTruthy();
      expect(p.address).toBeTruthy();
      expect(p.occupation).toBeTruthy();
      expect(p.clinicId).toBe(clinicId);
      expect(p.active).toBe(1);
      expect(p.createdAt).toBeTruthy();
      expect(p.updatedAt).toBeTruthy();
    });

    it('患者编码应递增', () => {
      resetPatientCodeCounter();
      const patients = createPatients(3, { clinicId });
      expect(patients[0].code).toBe('P000001');
      expect(patients[1].code).toBe('P000002');
      expect(patients[2].code).toBe('P000003');
    });

    it('重置计数器后编码从 1 重新开始', () => {
      createPatients(5, { clinicId });
      resetPatientCodeCounter();
      const patients = createPatients(1, { clinicId });
      expect(patients[0].code).toBe('P000001');
    });
  });

  describe('createAppointments', () => {
    it('应生成指定数量的预约', () => {
      const patients = [{ id: 'p1' }, { id: 'p2' }];
      const doctors = [{ id: 'd1' }, { id: 'd2' }];
      const appointments = createAppointments(5, { clinicId, patients, doctors });
      expect(appointments).toHaveLength(5);
    });

    it('预约应有所有必需字段', () => {
      const patients = [{ id: 'p1' }];
      const doctors = [{ id: 'd1' }];
      const chairs = [{ id: 'c1' }];
      const appointments = createAppointments(1, { clinicId, patients, doctors, chairs });
      const a = appointments[0];

      expect(a.id).toBeTruthy();
      expect(a.patientId).toBeTruthy();
      expect(a.doctorId).toBeTruthy();
      expect(a.startTime).toBeTruthy();
      expect(a.endTime).toBeTruthy();
      expect(a.status).toBeTruthy();
      expect(a.type).toBeTruthy();
      expect(a.clinicId).toBe(clinicId);
      expect(a.createdAt).toBeTruthy();
      expect(a.updatedAt).toBeTruthy();
    });

    it('没有患者时返回空数组', () => {
      const appointments = createAppointments(5, { clinicId, patients: [], doctors: [{ id: 'd1' }] });
      expect(appointments).toHaveLength(0);
    });

    it('没有医生时返回空数组', () => {
      const appointments = createAppointments(5, { clinicId, patients: [{ id: 'p1' }], doctors: [] });
      expect(appointments).toHaveLength(0);
    });
  });

  describe('createCharges', () => {
    it('应生成指定数量的收费单', () => {
      const patients = [{ id: 'p1' }, { id: 'p2' }];
      const doctors = [{ id: 'd1' }];
      const charges = createCharges(3, { clinicId, patients, doctors });
      expect(charges).toHaveLength(3);
    });

    it('收费单金额应为安全整数（分）', () => {
      const patients = [{ id: 'p1' }];
      const doctors = [{ id: 'd1' }];
      const charges = createCharges(10, { clinicId, patients, doctors });

      for (const c of charges) {
        expect(Number.isSafeInteger(c.totalAmount)).toBe(true);
        expect(Number.isSafeInteger(c.paidAmount)).toBe(true);
        expect(Number.isSafeInteger(c.refundedAmount)).toBe(true);
        expect(Number.isSafeInteger(c.discount)).toBe(true);

        for (const item of c.items) {
          expect(Number.isSafeInteger(item.price)).toBe(true);
          expect(Number.isSafeInteger(item.subtotal)).toBe(true);
        }
      }
    });

    it('收费单应有所有必需字段', () => {
      const patients = [{ id: 'p1' }];
      const doctors = [{ id: 'd1' }];
      const charges = createCharges(1, { clinicId, patients, doctors });
      const c = charges[0];

      expect(c.id).toBeTruthy();
      expect(c.patientId).toBe('p1');
      expect(c.number).toBeTruthy();
      expect(c.status).toBeTruthy();
      expect(c.clinicId).toBe(clinicId);
      expect(c.items.length).toBeGreaterThan(0);
      expect(c.createdAt).toBeTruthy();
      expect(c.updatedAt).toBeTruthy();
    });

    it('收费项目小计应等于单价乘以数量', () => {
      const patients = [{ id: 'p1' }];
      const doctors = [{ id: 'd1' }];
      const charges = createCharges(5, { clinicId, patients, doctors });

      for (const c of charges) {
        for (const item of c.items) {
          expect(item.subtotal).toBe(item.price * item.quantity);
        }
      }
    });

    it('没有患者时返回空数组', () => {
      const charges = createCharges(5, { clinicId, patients: [], doctors: [] });
      expect(charges).toHaveLength(0);
    });
  });

  describe('createInventoryItems', () => {
    it('应生成指定数量的库存物品', () => {
      const items = createInventoryItems(5, { clinicId });
      expect(items).toHaveLength(5);
    });

    it('库存物品应有所有必需字段', () => {
      const items = createInventoryItems(1, { clinicId });
      const item = items[0];

      expect(item.id).toBeTruthy();
      expect(item.code).toMatch(/^INV\d{6}$/);
      expect(item.name).toBeTruthy();
      expect(item.spec).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.unit).toBeTruthy();
      expect(item.clinicId).toBe(clinicId);
      expect(item.createdAt).toBeTruthy();
      expect(item.updatedAt).toBeTruthy();
    });

    it('库存物品价格应为安全整数（分）', () => {
      const items = createInventoryItems(10, { clinicId });
      for (const item of items) {
        expect(Number.isSafeInteger(item.price)).toBe(true);
        expect(Number.isSafeInteger(item.stock)).toBe(true);
        expect(Number.isSafeInteger(item.minStock)).toBe(true);
      }
    });
  });

  describe('createMemberCards', () => {
    it('应生成指定数量的会员卡', () => {
      const patients = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
      const cards = createMemberCards(2, { clinicId, patients });
      expect(cards).toHaveLength(2);
    });

    it('会员卡应有所有必需字段', () => {
      const patients = [{ id: 'p1' }];
      const cards = createMemberCards(1, { clinicId, patients });
      const card = cards[0];

      expect(card.id).toBeTruthy();
      expect(card.patientId).toBe('p1');
      expect(card.cardNo).toMatch(/^MC\d{8}$/);
      expect(card.level).toBeTruthy();
      expect(card.status).toBeTruthy();
      expect(card.clinicId).toBe(clinicId);
      expect(card.createdAt).toBeTruthy();
      expect(card.updatedAt).toBeTruthy();
    });

    it('会员卡金额字段应为安全整数（分）', () => {
      const patients = [{ id: 'p1' }];
      const cards = createMemberCards(5, { clinicId, patients });
      for (const card of cards) {
        expect(Number.isSafeInteger(card.balance)).toBe(true);
        expect(Number.isSafeInteger(card.totalRecharge)).toBe(true);
        expect(Number.isSafeInteger(card.totalConsume)).toBe(true);
        expect(Number.isSafeInteger(card.points)).toBe(true);
        expect(Number.isSafeInteger(card.totalPoints)).toBe(true);
      }
    });

    it('余额应不小于 0', () => {
      const patients = [{ id: 'p1' }];
      const cards = createMemberCards(10, { clinicId, patients });
      for (const card of cards) {
        expect(card.balance).toBeGreaterThanOrEqual(0);
      }
    });

    it('消费金额不应超过充值金额', () => {
      const patients = [{ id: 'p1' }];
      const cards = createMemberCards(10, { clinicId, patients });
      for (const card of cards) {
        expect(card.totalConsume).toBeLessThanOrEqual(card.totalRecharge);
      }
    });

    it('卡数量不超过患者数量', () => {
      const patients = [{ id: 'p1' }, { id: 'p2' }];
      const cards = createMemberCards(10, { clinicId, patients });
      expect(cards.length).toBeLessThanOrEqual(patients.length);
    });

    it('没有患者时返回空数组', () => {
      const cards = createMemberCards(5, { clinicId, patients: [] });
      expect(cards).toHaveLength(0);
    });
  });
});

describe('生成数据质量', () => {
  const clinicId = 'quality-test-clinic';

  it('患者标签和过敏史应为有效 JSON', () => {
    const patients = createPatients(5, { clinicId });
    for (const p of patients) {
      expect(() => JSON.parse(p.tags)).not.toThrow();
      expect(() => JSON.parse(p.allergies)).not.toThrow();
      expect(() => JSON.parse(p.medicalHistory)).not.toThrow();
      expect(() => JSON.parse(p.systemicDiseases)).not.toThrow();
    }
  });

  it('收费单 totalAmount 应等于所有项目小计之和减去折扣', () => {
    const patients = [{ id: 'p1' }];
    const doctors = [{ id: 'd1' }];
    const charges = createCharges(10, { clinicId, patients, doctors });

    for (const c of charges) {
      const itemsSubtotal = c.items.reduce((sum, item) => sum + item.subtotal, 0);
      expect(c.totalAmount).toBe(itemsSubtotal - c.discount);
    }
  });

  it('预约结束时间应在开始时间之后', () => {
    const patients = [{ id: 'p1' }];
    const doctors = [{ id: 'd1' }];
    const appointments = createAppointments(10, { clinicId, patients, doctors });

    for (const a of appointments) {
      expect(new Date(a.endTime).getTime()).toBeGreaterThan(new Date(a.startTime).getTime());
    }
  });
});
