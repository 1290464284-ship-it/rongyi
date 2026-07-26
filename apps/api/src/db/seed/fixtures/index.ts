export const FIXTURE_CLINIC_ID = 'fixture-clinic-001';
export const FIXTURE_ADMIN_ID = 'fixture-admin-001';
export const FIXTURE_DOCTOR_ID = 'fixture-doctor-001';
export const FIXTURE_DOCTOR_2_ID = 'fixture-doctor-002';
export const FIXTURE_PATIENT_ID = 'fixture-patient-001';
export const FIXTURE_PATIENT_2_ID = 'fixture-patient-002';
export const FIXTURE_CHARGE_ID = 'fixture-charge-001';
export const FIXTURE_MEMBER_CARD_ID = 'fixture-card-001';

export const bugReproductionFixtures = {
  partialPaymentThenFullRefund: {
    description: '部分支付后全额退款 - 验证状态转换是否正确',
    data: {
      charge: {
        id: 'bug-charge-partial-refund',
        patientId: FIXTURE_PATIENT_ID,
        totalAmount: 100000,
        paidAmount: 50000,
        refundedAmount: 50000,
        status: 'REFUNDED',
      },
    },
    expected: {
      status: 'REFUNDED',
      refundedAmount: 50000,
    },
  },

  zeroAmountCharge: {
    description: '零金额收费单 - 验证边界情况处理',
    data: {
      charge: {
        id: 'bug-charge-zero-amount',
        patientId: FIXTURE_PATIENT_ID,
        totalAmount: 0,
        paidAmount: 0,
        status: 'PAID',
      },
    },
    expected: {
      status: 'PAID',
      totalAmount: 0,
    },
  },

  memberCardInsufficientBalance: {
    description: '会员卡余额不足 - 验证支付失败场景',
    data: {
      memberCard: {
        id: FIXTURE_MEMBER_CARD_ID,
        patientId: FIXTURE_PATIENT_ID,
        cardNo: 'BUGTEST001',
        balance: 1000,
        totalRecharge: 1000,
        totalConsume: 0,
        status: 'ACTIVE',
      },
    },
    expected: {
      balance: 1000,
    },
  },

  overlappingAppointments: {
    description: '同一医生时间重叠的预约 - 验证冲突检测',
    data: {
      appointment1: {
        id: 'bug-apt-overlap-1',
        patientId: FIXTURE_PATIENT_ID,
        doctorId: FIXTURE_DOCTOR_ID,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        status: 'BOOKED',
      },
      appointment2: {
        id: 'bug-apt-overlap-2',
        patientId: FIXTURE_PATIENT_2_ID,
        doctorId: FIXTURE_DOCTOR_ID,
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
        status: 'BOOKED',
      },
    },
    expected: {
      shouldConflict: true,
    },
  },
};

export const performanceTestFixtures = {
  largePatientDataset: {
    description: '大数据量患者列表 - 用于性能测试',
    counts: {
      patients: 1000,
      appointments: 5000,
      charges: 3000,
    },
  },

  concurrentChargePayment: {
    description: '并发支付场景 - 用于并发测试',
    data: {
      charge: {
        id: 'perf-charge-concurrent',
        patientId: FIXTURE_PATIENT_ID,
        totalAmount: 10000,
        paidAmount: 0,
        status: 'UNPAID',
      },
      concurrentPayments: 10,
    },
  },
};

export const edgeCaseFixtures = {
  patientWithAllergies: {
    description: '有多种过敏史的患者',
    data: {
      patient: {
        id: 'edge-patient-allergies',
        code: 'EDGE001',
        name: '过敏测试患者',
        gender: 'MALE',
        birthDate: '1990-01-01',
        phone: '13900000001',
        allergies: JSON.stringify(['青霉素过敏', '头孢过敏', '乳胶过敏', '海鲜过敏']),
        medicalHistory: JSON.stringify(['高血压', '糖尿病', '心脏病']),
        systemicDiseases: JSON.stringify(['系统性红斑狼疮', '类风湿性关节炎']),
      },
    },
  },

  elderlyPatient: {
    description: '老年患者（80岁以上）',
    data: {
      patient: {
        id: 'edge-patient-elderly',
        code: 'EDGE002',
        name: '高龄患者',
        gender: 'FEMALE',
        birthDate: '1940-01-01',
        phone: '13900000002',
        medicalHistory: JSON.stringify(['高血压', '糖尿病', '冠心病', '骨质疏松']),
      },
    },
  },

  childPatient: {
    description: '儿童患者（3岁以下）',
    data: {
      patient: {
        id: 'edge-patient-child',
        code: 'EDGE003',
        name: '儿童患者',
        gender: 'MALE',
        birthDate: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        phone: '13900000003',
        source: 'WALK_IN',
      },
    },
  },

  highValueCharge: {
    description: '高价值收费单（种植牙等）',
    data: {
      charge: {
        id: 'edge-charge-high-value',
        patientId: FIXTURE_PATIENT_ID,
        totalAmount: 5000000,
        paidAmount: 5000000,
        status: 'PAID',
        items: [
          { name: '种植牙(欧美系)', category: '修复治疗', price: 800000, quantity: 6 },
          { name: '全瓷冠', category: '修复治疗', price: 250000, quantity: 2 },
        ],
      },
    },
  },

  largeInventory: {
    description: '库存为0和库存很大的边界情况',
    items: [
      { name: '紧缺物品', stock: 0, minStock: 50 },
      { name: '充足物品', stock: 10000, minStock: 100 },
      { name: '刚好最低库存', stock: 50, minStock: 50 },
    ],
  },
};

export const businessScenarioFixtures = {
  fullPatientJourney: {
    description: '完整患者就诊流程：预约 -> 挂号 -> 就诊 -> 收费 -> 会员卡支付',
    steps: ['appointment', 'registration', 'visit', 'charge', 'payment', 'memberCardDeduction'],
  },

  memberCardLifecycle: {
    description: '会员卡完整生命周期：办卡 -> 充值 -> 消费 -> 积分 -> 升级',
    steps: ['createCard', 'recharge1', 'consume1', 'recharge2', 'consume2', 'levelUp'],
  },

  refundFlow: {
    description: '退款流程：收费 -> 支付 -> 部分退款 -> 全额退款',
    steps: ['createCharge', 'fullPayment', 'partialRefund', 'fullRefund'],
  },
};
