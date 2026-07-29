import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PasswordPolicyService } from './password-policy.service';
import { UserManagementService } from './user-management.service';
import { CommonServicesModule } from '../../common/services/common-services.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get('JWT_SECRET'),
        signOptions: { expiresIn: c.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
    CommonServicesModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordPolicyService, UserManagementService],
  exports: [AuthService, PasswordPolicyService, UserManagementService],
})
export class AuthModule {}
