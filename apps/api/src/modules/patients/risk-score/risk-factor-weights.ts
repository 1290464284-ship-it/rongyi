export interface CariesWeights {
  dtWeight: number;
  ageUnder12: number;
  sugarFreq: number;
  plaqueRetention: number;
  priorRctWeight: number;
  fluoride: number;
  family: number;
}

export interface PeriodontalWeights {
  pdGte6Weight: number;
  boneLossMild: number;
  boneLossModerate: number;
  boneLossSevere: number;
  mobility: number;
  smokingHeavy: number;
  smokingLight: number;
  diabetes: number;
  family: number;
  ageOver60: number;
}

export interface ImplantWeights {
  plaqueHigh: number;
  smokingHeavy: number;
  smokingLight: number;
  diabetes: number;
  history: number;
  occlusal: number;
  implantAgeOver5: number;
  implantAgeOver10: number;
  poorMaintenance: number;
  systemic: number;
}

export interface RiskWeights {
  caries: CariesWeights;
  periodontal: PeriodontalWeights;
  implant: ImplantWeights;
}

export const DEFAULT_CARIES_WEIGHTS: CariesWeights = {
  dtWeight: 10,
  ageUnder12: 20,
  sugarFreq: 15,
  plaqueRetention: 15,
  priorRctWeight: 5,
  fluoride: 10,
  family: 10,
};

export const DEFAULT_PERIODONTAL_WEIGHTS: PeriodontalWeights = {
  pdGte6Weight: 8,
  boneLossMild: 5,
  boneLossModerate: 15,
  boneLossSevere: 30,
  mobility: 6,
  smokingHeavy: 25,
  smokingLight: 10,
  diabetes: 25,
  family: 15,
  ageOver60: 10,
};

export const DEFAULT_IMPLANT_WEIGHTS: ImplantWeights = {
  plaqueHigh: 15,
  smokingHeavy: 20,
  smokingLight: 10,
  diabetes: 20,
  history: 15,
  occlusal: 10,
  implantAgeOver5: 8,
  implantAgeOver10: 15,
  poorMaintenance: 10,
  systemic: 10,
};

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  caries: DEFAULT_CARIES_WEIGHTS,
  periodontal: DEFAULT_PERIODONTAL_WEIGHTS,
  implant: DEFAULT_IMPLANT_WEIGHTS,
};

export const CARIES_WEIGHT_KEYS: Record<keyof CariesWeights, string> = {
  dtWeight: 'aiRiskCariesDtWeight',
  ageUnder12: 'aiRiskCariesAgeUnder12',
  sugarFreq: 'aiRiskCariesSugarFreq',
  plaqueRetention: 'aiRiskCariesPlaqueRetention',
  priorRctWeight: 'aiRiskCariesPriorRctWeight',
  fluoride: 'aiRiskCariesFluoride',
  family: 'aiRiskCariesFamily',
};

export const PERIODONTAL_WEIGHT_KEYS: Record<keyof PeriodontalWeights, string> = {
  pdGte6Weight: 'aiRiskPeriodontalPdGte6Weight',
  boneLossMild: 'aiRiskPeriodontalBoneLossMild',
  boneLossModerate: 'aiRiskPeriodontalBoneLossModerate',
  boneLossSevere: 'aiRiskPeriodontalBoneLossSevere',
  mobility: 'aiRiskPeriodontalMobility',
  smokingHeavy: 'aiRiskPeriodontalSmokingHeavy',
  smokingLight: 'aiRiskPeriodontalSmokingLight',
  diabetes: 'aiRiskPeriodontalDiabetes',
  family: 'aiRiskPeriodontalFamily',
  ageOver60: 'aiRiskPeriodontalAgeOver60',
};

export const IMPLANT_WEIGHT_KEYS: Record<keyof ImplantWeights, string> = {
  plaqueHigh: 'aiRiskImplantPlaqueHigh',
  smokingHeavy: 'aiRiskImplantSmokingHeavy',
  smokingLight: 'aiRiskImplantSmokingLight',
  diabetes: 'aiRiskImplantDiabetes',
  history: 'aiRiskImplantHistory',
  occlusal: 'aiRiskImplantOcclusal',
  implantAgeOver5: 'aiRiskImplantAgeOver5',
  implantAgeOver10: 'aiRiskImplantAgeOver10',
  poorMaintenance: 'aiRiskImplantPoorMaintenance',
  systemic: 'aiRiskImplantSystemic',
};

export const RISK_LEVEL_THRESHOLDS = {
  LOW_MAX: 29,
  MEDIUM_MIN: 30,
  MEDIUM_MAX: 59,
  HIGH_MIN: 60,
  HIGH_MAX: 79,
  EXTREME_MIN: 80,
} as const;

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export function scoreToLevel(score: number): RiskLevel {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  if (s >= RISK_LEVEL_THRESHOLDS.EXTREME_MIN) return 'EXTREME';
  if (s >= RISK_LEVEL_THRESHOLDS.HIGH_MIN) return 'HIGH';
  if (s >= RISK_LEVEL_THRESHOLDS.MEDIUM_MIN) return 'MEDIUM';
  return 'LOW';
}

export interface SettingsWeightDefaults {
  key: string;
  defaultValue: string;
}

export function getAllSettingsWeightDefaults(): SettingsWeightDefaults[] {
  const result: SettingsWeightDefaults[] = [];
  (Object.keys(CARIES_WEIGHT_KEYS) as Array<keyof CariesWeights>).forEach(k => {
    result.push({
      key: CARIES_WEIGHT_KEYS[k],
      defaultValue: String(DEFAULT_CARIES_WEIGHTS[k]),
    });
  });
  (Object.keys(PERIODONTAL_WEIGHT_KEYS) as Array<keyof PeriodontalWeights>).forEach(k => {
    result.push({
      key: PERIODONTAL_WEIGHT_KEYS[k],
      defaultValue: String(DEFAULT_PERIODONTAL_WEIGHTS[k]),
    });
  });
  (Object.keys(IMPLANT_WEIGHT_KEYS) as Array<keyof ImplantWeights>).forEach(k => {
    result.push({
      key: IMPLANT_WEIGHT_KEYS[k],
      defaultValue: String(DEFAULT_IMPLANT_WEIGHTS[k]),
    });
  });
  return result;
}
