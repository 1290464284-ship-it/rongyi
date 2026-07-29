import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * Custom extractor: try cookie first, fallback to Authorization header.
 * This allows gradual migration from localStorage (Bearer) to httpOnly cookie.
 */
const extractJwtFromCookieOrHeader = (req: Request): string | null => {
  // Try cookie first (preferred)
  if (req.cookies?.['access_token']) {
    return req.cookies['access_token'];
  }
  // Fallback to Authorization header (for backward compatibility)
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private auth: AuthService) {
    super({
      jwtFromRequest: extractJwtFromCookieOrHeader,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
      passReqToCallback: false,
      issuer: 'dental-api',
      audience: 'dental-web',
    });
  }

  async validate(payload: { sub: string; tv?: number; cid?: string }) {
    // 同时校验 tokenVersion，若 user 表的 tokenVersion 与 token 中的不一致则拒绝
    const user = await this.auth.validateById(payload.sub, payload.tv);
    if (!user) throw new UnauthorizedException();
    // P3: 多诊所扩展 — 将 clinicId 附加到 request.user，供后续 ClinicContext 使用
    return { ...user, clinicId: payload.cid || user.clinicId };
  }
}
