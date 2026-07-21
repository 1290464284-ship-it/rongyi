import { Body, Controller, Get, HttpCode, Post, Patch, Delete, Param, Query, UseGuards, BadRequestException, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/types/enums';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';


interface JwtUser { id: string; username: string; name: string; role: string; }

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
};

const ACCESS_TOKEN_MAX_AGE = 3600 * 1000; // 1 hour
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 days

@ApiTags('认证与用户管理')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @HttpCode(200)
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
    
    // Also return tokens in body for backward compatibility during migration
    // TODO: Remove this once frontend fully migrates to cookie-based auth
    return result;
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string, @Res({ passthrough: true }) res: Response) {
    if (!refreshToken) throw new BadRequestException('refreshToken 不能为空');
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
    
    // Also return tokens in body for backward compatibility during migration
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: JwtUser, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(user.id);
    
    // Clear cookies
    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);
    
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Roles(Role.BOSS)
  @Get('users')
  listUsers(@Query('role') role?: string) {
    return this.auth.listUsers(role);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(Role.BOSS)
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(Role.BOSS)
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

  @UseGuards(JwtAuthGuard)
  @Roles(Role.BOSS)
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.auth.deleteUser(id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }
}
