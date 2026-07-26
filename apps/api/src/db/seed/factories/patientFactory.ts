import * as crypto from 'node:crypto';

export interface PatientSeedData {
  id: string;
  code: string;
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
  idCard: string;
  address: string;
  occupation: string;
  remark: string;
  tags: string;
  allergies: string;
  medicalHistory: string;
  medicationHistory: string;
  systemicDiseases: string;
  source: string;
  emergencyContact: string;
  emergencyPhone: string;
  clinicId: string;
  active: number;
  createdAt: string;
  updatedAt: string;
}

const FIRST_NAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
const MALE_NAMES = ['伟', '强', '磊', '军', '洋', '勇', '杰', '涛', '明', '超', '辉', '鹏', '华', '飞', '龙'];
const FEMALE_NAMES = ['芳', '娜', '敏', '静', '丽', '艳', '娟', '燕', '玲', '霞', '婷', '雪', '梅', '琳', '莉'];

const OCCUPATIONS = ['教师', '医生', '工程师', '会计', '律师', '设计师', '程序员', '销售', '护士', '公务员', '学生', '自由职业', '退休', '企业员工', '个体户'];

const CITIES = ['北京市朝阳区', '上海市浦东新区', '广州市天河区', '深圳市南山区', '杭州市西湖区', '成都市武侯区', '武汉市洪山区', '南京市鼓楼区'];

const STREETS = ['建国路', '人民路', '中山路', '解放路', '建设路', '文化路', '科技路', '和平街', '幸福里', '安康小区'];

const SOURCES = ['WALK_IN', 'REFERRAL', 'ONLINE', 'PHONE', 'WECHAT', 'OTHER'];

const TAGS = ['VIP', '新客户', '老客户', '儿童', '老年人', '孕妇', '糖尿病', '高血压', '心脏病', '过敏体质'];

const ALLERGIES = ['青霉素过敏', '头孢过敏', '花粉过敏', '海鲜过敏', '花生过敏', '乳胶过敏', '磺胺类过敏', '局麻药过敏'];

const MEDICAL_HISTORY = ['高血压', '糖尿病', '心脏病', '肝炎', '肾病', '甲状腺疾病', '风湿性关节炎', '哮喘'];

const SYSTEMIC_DISEASES = ['高血压', '糖尿病', '冠心病', '肝硬化', '慢性肾炎', '甲状腺功能亢进', '系统性红斑狼疮', '类风湿性关节炎'];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(): string {
  const prefixes = ['138', '139', '137', '136', '135', '158', '159', '188', '189', '186', '150', '151', '152'];
  const prefix = randomItem(prefixes);
  const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return prefix + suffix;
}

function randomIdCard(): string {
  const areaCode = '110101';
  const year = 1960 + Math.floor(Math.random() * 55);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const checkCode = Math.floor(Math.random() * 10);
  return `${areaCode}${year}${month}${day}${seq}${checkCode}`;
}

function randomBirthDate(): string {
  const year = 1955 + Math.floor(Math.random() * 60);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function randomAddress(): string {
  const city = randomItem(CITIES);
  const street = randomItem(STREETS);
  const num = Math.floor(Math.random() * 200) + 1;
  const unit = Math.floor(Math.random() * 30) + 1;
  const room = Math.floor(Math.random() * 1000) + 1;
  return `${city}${street}${num}号${unit}单元${room}室`;
}

function randomSubset<T>(arr: T[], maxCount: number = 3): T[] {
  const count = Math.floor(Math.random() * (maxCount + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

let patientCodeCounter = 0;

export function createPatient(
  overrides: Partial<PatientSeedData> & { clinicId: string },
): PatientSeedData {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  patientCodeCounter++;
  const code = overrides.code || `P${String(patientCodeCounter).padStart(6, '0')}`;

  const gender = overrides.gender || randomItem(['MALE', 'FEMALE']);
  const nameList = gender === 'MALE' ? MALE_NAMES : FEMALE_NAMES;
  const name = overrides.name || randomItem(FIRST_NAMES) + randomItem(nameList);

  const birthDate = overrides.birthDate || randomBirthDate();

  const tags = overrides.tags || JSON.stringify(randomSubset(TAGS, 2));
  const allergies = overrides.allergies || JSON.stringify(randomSubset(ALLERGIES, 2));
  const medicalHistory = overrides.medicalHistory || JSON.stringify(randomSubset(MEDICAL_HISTORY, 2));
  const medicationHistory = overrides.medicationHistory || '[]';
  const systemicDiseases = overrides.systemicDiseases || JSON.stringify(randomSubset(SYSTEMIC_DISEASES, 1));

  return {
    id,
    code,
    name,
    gender,
    birthDate,
    phone: overrides.phone || randomPhone(),
    idCard: overrides.idCard || randomIdCard(),
    address: overrides.address || randomAddress(),
    occupation: overrides.occupation || randomItem(OCCUPATIONS),
    remark: overrides.remark || '',
    tags,
    allergies,
    medicalHistory,
    medicationHistory,
    systemicDiseases,
    source: overrides.source || randomItem(SOURCES),
    emergencyContact: overrides.emergencyContact || randomItem(FIRST_NAMES) + randomItem(MALE_NAMES),
    emergencyPhone: overrides.emergencyPhone || randomPhone(),
    clinicId: overrides.clinicId,
    active: overrides.active ?? 1,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function createPatients(
  count: number,
  baseOverrides: Partial<PatientSeedData> & { clinicId: string },
): PatientSeedData[] {
  const result: PatientSeedData[] = [];
  for (let i = 0; i < count; i++) {
    result.push(createPatient(baseOverrides));
  }
  return result;
}

export function resetPatientCodeCounter(): void {
  patientCodeCounter = 0;
}
