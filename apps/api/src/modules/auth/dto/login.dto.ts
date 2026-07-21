import { IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password!: string;
}
