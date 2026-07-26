import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { CreateMedicalRecordDto } from './create-medical-record.dto';

export class UpdateMedicalRecordDto extends PartialType(CreateMedicalRecordDto) {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  patientId?: string;

  @ApiProperty({ description: '就诊记录ID', example: 'visit-uuid-001', required: false })
  visitId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  doctorId?: string;

  @ApiProperty({ description: '病历模板ID', example: 'template-uuid-001', required: false })
  templateId?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛3天', required: false })
  chiefComplaint?: string;

  @ApiProperty({ description: '现病史', example: '患者3天前无明显诱因出现右上后牙疼痛，冷热刺激加重...', required: false })
  presentIllness?: string;

  @ApiProperty({ description: '既往史', example: '体健，否认系统性疾病史', required: false })
  pastHistory?: string;

  @ApiProperty({ description: '过敏史', example: '否认药物过敏史', required: false })
  allergyHistory?: string;

  @ApiProperty({ description: '检查所见', example: '16合面深龋，探诊(+)，冷测(+)，叩诊(-)', required: false })
  examination?: string;

  @ApiProperty({ description: '诊断', example: '16深龋', required: false })
  diagnosis?: string;

  @ApiProperty({ description: '治疗计划', example: '16树脂充填治疗', required: false })
  treatmentPlan?: string;

  @ApiProperty({ description: '涉及牙位', type: 'array', items: { type: 'string' }, example: ['16', '26'], required: false })
  teethInvolved?: string[];

  @ApiProperty({ description: '影像图片URL列表', type: 'array', items: { type: 'string' }, required: false })
  images?: string[];

  @ApiProperty({ description: '医生签名', required: false })
  signature?: string;

  @ApiProperty({ description: '是否锁定（0-否，1-是）', example: 0, required: false })
  isLocked?: number;
}
