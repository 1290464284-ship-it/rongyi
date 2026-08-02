 
import { Injectable } from '@nestjs/common';
import { MeasurementResult, SeverityLevel } from './measurements.service';

export type SkeletalClass = 'ClassI' | 'ClassII' | 'ClassIII';
export type DentalClass = 'ClassI' | 'ClassII' | 'ClassIII';
export type VerticalType = 'Average' | 'High' | 'Low';

export interface IssueFlag {
  code: string;
  value: number;
  norm: number;
  severity: SeverityLevel;
  msg: string;
}

export interface ClassificationResult {
  skeletal: SkeletalClass;
  dental: DentalClass;
  vertical: VerticalType;
  summary: string;
  issueFlags: IssueFlag[];
}

@Injectable()
export class CephalometricClassificationService {
  classify(measurements: MeasurementResult): ClassificationResult {
    const ANB = measurements.ANB?.value;
    const Wits = measurements.Wits?.value;
    const SNMP = measurements['SN-MP']?.value;
    const Overjet = measurements.Overjet?.value;
    const U1SN = measurements['U1-SN']?.value;

    let skeletal: SkeletalClass = 'ClassI';
    if (ANB != null) {
      if (ANB > 4) {
        skeletal = 'ClassII';
      } else if (ANB < 0) {
        skeletal = 'ClassIII';
      }
    }
    if (Wits != null) {
      if (skeletal === 'ClassI' && Wits > 2) {
        skeletal = 'ClassII';
      } else if (skeletal === 'ClassI' && Wits < -2) {
        skeletal = 'ClassIII';
      }
    }

    let dental: DentalClass = 'ClassI';
    if (Overjet != null) {
      if (Overjet > 3 && U1SN != null && U1SN > 105) {
        dental = 'ClassII';
      } else if (Overjet < -1) {
        dental = 'ClassIII';
      } else if (Overjet > 3) {
        dental = 'ClassII';
      }
    }

    let vertical: VerticalType = 'Average';
    if (SNMP != null) {
      if (SNMP > 38) {
        vertical = 'High';
      } else if (SNMP < 29) {
        vertical = 'Low';
      }
    }

    const anglePart = dental === 'ClassI' ? 'Angle Class I' :
      dental === 'ClassII' ? 'Angle Class II' : 'Angle Class III';
    const vertPart = vertical === 'Average' ? '平均型' :
      vertical === 'High' ? '高角型' : '低角型';
    const skelPart = skeletal === 'ClassI' ? '骨性 I 类' :
      skeletal === 'ClassII' ? '骨性 II 类' : '骨性 III 类';
    const summary = `${anglePart} / ${vertPart} / ${skelPart}`;

    const issueFlags: IssueFlag[] = [];

    if (ANB != null) {
      const anbSd = measurements.ANB.sd || 2;
      const delta = ANB - (measurements.ANB.norm || 2);
      const sev: SeverityLevel = this.deltaToSev(delta, anbSd);
      if (ANB > 4) {
        issueFlags.push({
          code: 'ANB_HIGH',
          value: ANB,
          norm: measurements.ANB.norm || 2,
          severity: sev,
          msg: '骨性 II 类倾向（ANB 偏大）',
        });
      } else if (ANB < 0) {
        issueFlags.push({
          code: 'ANB_LOW',
          value: ANB,
          norm: measurements.ANB.norm || 2,
          severity: sev,
          msg: '骨性 III 类倾向（ANB 偏小）',
        });
      }
    }

    if (Wits != null) {
      const witsSd = measurements.Wits.sd || 2;
      if (Math.abs(Wits) > 2) {
        const delta = Wits;
        const sev: SeverityLevel = this.deltaToSev(delta, witsSd);
        issueFlags.push({
          code: Wits > 0 ? 'WITS_HIGH' : 'WITS_LOW',
          value: Wits,
          norm: measurements.Wits.norm || 0,
          severity: sev,
          msg: Wits > 0 ? 'Wits 值偏正（A 点前移倾向）' : 'Wits 值偏负（B 点前移倾向）',
        });
      }
    }

    if (SNMP != null) {
      const snmpSd = measurements['SN-MP'].sd || 5;
      if (SNMP > 38) {
        const delta = SNMP - 32;
        issueFlags.push({
          code: 'SNMP_HIGH',
          value: SNMP,
          norm: measurements['SN-MP'].norm || 32,
          severity: this.deltaToSev(delta, snmpSd),
          msg: '高角型（垂直生长型）',
        });
      } else if (SNMP < 29) {
        const delta = SNMP - 32;
        issueFlags.push({
          code: 'SNMP_LOW',
          value: SNMP,
          norm: measurements['SN-MP'].norm || 32,
          severity: this.deltaToSev(delta, snmpSd),
          msg: '低角型（水平生长型）',
        });
      }
    }

    if (Overjet != null) {
      const ovjSd = measurements.Overjet.sd || 1.5;
      if (Overjet > 3) {
        const delta = Overjet - 2;
        issueFlags.push({
          code: 'OVERJET_HIGH',
          value: Overjet,
          norm: measurements.Overjet.norm || 2,
          severity: this.deltaToSev(delta, ovjSd),
          msg: '覆盖偏大（前突倾向）',
        });
      } else if (Overjet < 0) {
        const delta = Overjet - 2;
        issueFlags.push({
          code: 'OVERJET_LOW',
          value: Overjet,
          norm: measurements.Overjet.norm || 2,
          severity: this.deltaToSev(delta, ovjSd),
          msg: '反𬌗倾向（覆盖为负）',
        });
      }
    }

    const Overbite = measurements.Overbite?.value;
    if (Overbite != null) {
      const ovbSd = measurements.Overbite.sd || 1;
      if (Overbite > 4) {
        const delta = Overbite - 2;
        issueFlags.push({
          code: 'OVERBITE_HIGH',
          value: Overbite,
          norm: measurements.Overbite.norm || 2,
          severity: this.deltaToSev(delta, ovbSd),
          msg: '深覆𬌗',
        });
      } else if (Overbite < 0) {
        const delta = Overbite - 2;
        issueFlags.push({
          code: 'OVERBITE_LOW',
          value: Overbite,
          norm: measurements.Overbite.norm || 2,
          severity: this.deltaToSev(delta, ovbSd),
          msg: '开𬌗倾向',
        });
      }
    }

    if (U1SN != null) {
      const sd = measurements['U1-SN'].sd || 5;
      if (U1SN > 110) {
        const delta = U1SN - 105;
        issueFlags.push({
          code: 'U1SN_LABIAL',
          value: U1SN,
          norm: measurements['U1-SN'].norm || 105,
          severity: this.deltaToSev(delta, sd),
          msg: '上中切牙唇倾',
        });
      } else if (U1SN < 100) {
        const delta = U1SN - 105;
        issueFlags.push({
          code: 'U1SN_LINGUAL',
          value: U1SN,
          norm: measurements['U1-SN'].norm || 105,
          severity: this.deltaToSev(delta, sd),
          msg: '上中切牙舌倾',
        });
      }
    }

    return {
      skeletal,
      dental,
      vertical,
      summary,
      issueFlags,
    };
  }

  private deltaToSev(delta: number, sd: number): SeverityLevel {
    const ratio = Math.abs(delta) / Math.max(sd, 0.0001);
    if (ratio >= 2.5) return 3;
    if (ratio >= 1.5) return 2;
    if (ratio >= 0.5) return 1;
    return 0;
  }
}
