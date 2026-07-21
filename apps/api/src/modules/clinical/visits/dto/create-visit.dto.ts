import { IsString, IsOptional } from 'class-validator';

export class CreateVisitDto {
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsString()
  patientId!: string;

  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsString()
  treatmentPlan?: string;
}
