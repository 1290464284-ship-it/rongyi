import { IsString, IsOptional } from 'class-validator';

export class TriageRegistrationDto {
  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  triageNote?: string;
}
