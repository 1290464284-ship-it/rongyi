import { BusinessValidationException } from '@common/errors';
import { Body, Controller, Get, HttpCode, Post, Patch, Delete, Param, Query, Res, Req } from '@nestjs/common';

import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../common/decorators/operation-log-resource.decorator';
import { Public } from '../../common/decorators/public.decorator';


interface JwtUser { id: string; username: string; name: string; role: string; }

interface RequestWithCookies extends Request {
  cookies: Record<string, string>;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
};

const ACCESS_TOKEN_MAX_AGE = 3600 * 1000; // 1 hour
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 days

@ApiTags('认证与用户管理')
@OperationLogResource('用户')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '登录' })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    
    // Set httpOnly cookies for tokens
    res.cookie('access_token', result.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });
    res.cookie('refresh_token', result.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
    
    // D2-4: token 只通过 httpOnly cookie 传递，不返回在响应体中（防 XSS 窃取）
    return { user: result.user, needChangePassword: result.needChangePassword };
  }

  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '刷新令牌' })
  @Post('refresh')
  async refresh(@Req() req: RequestWithCookies, @Body('refreshToken') bodyRefreshToken: string, @Res({ passthrough: true }) res: Response) {
    // Prefer httpOnly cookie over body for consistency with D2-4 cookie-only design
    const refreshToken = req.cookies?.refresh_token || bodyRefreshToken;
    if (!refreshToken) throw new BusinessValidationException('refreshToken 不能为空');
    const result = await this.auth.refreshToken(refreshToken);

    // Update cookies with new tokens
    res.cookie('access_token', result.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });
    res.cookie('refresh_token', result.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });

    // D2-4: token 只通过 httpOnly cookie 传递
    return { ok: true };
  }

  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: '获取当前用户信息' })
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return user;
  }

  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  @HttpCode(200)
  @ApiOperation({ summary: '登出' })
  @Post('logout')
  async logout(@CurrentUser() user: JwtUser, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(user.id);
    
    // Clear cookies
    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);
    
    return result;
  }

  @Roles(Role.BOSS)
  @ApiOperation({ summary: '获取用户列表' })
  @Get('users')
  listUsers(@Query('role') role?: string) {
    return this.auth.listUsers(role);
  }

  @Roles(Role.BOSS)
  @ApiOperation({ summary: '创建用户' })
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @Roles(Role.BOSS)
  @ApiOperation({ summary: '更新用户' })
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const updates: { name?: string; role?: string; phone?: string; active?: number } = {
      name: dto.name,
      role: dto.role,
      phone: dto.phone,
    };
    if (dto.active !== undefined) updates.active = dto.active ? 1 : 0;
    return this.auth.updateUser(id, updates);
  }

  @Roles(Role.BOSS)
  @ApiOperation({ summary: '删除用户' })
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.auth.deleteUser(id);
  }

  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  @HttpCode(200)
  @ApiOperation({ summary: '修改密码' })
  @Post('change-password')
  changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }
}
