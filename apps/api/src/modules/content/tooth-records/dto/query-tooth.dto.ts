import { IsString } from 'class-validator';

export class QueryToothDto {
  @IsString()
  patientId!: string;
}
