import { PartialType } from '@nestjs/mapped-types';
import { Gender, PatientSource } from '@dental/shared';
import { CreatePatientDto } from './create-patient.dto';

export const PatientGender = Gender;
export type PatientGenderType = Gender;

export { PatientSource };

export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
