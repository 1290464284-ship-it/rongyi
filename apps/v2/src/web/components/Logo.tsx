interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  variant?: 'login' | 'sidebar';
}

import loginLogoUrl from '../assets/logo-ry-lockup.svg';
import sidebarLogoUrl from '../assets/logo-ry-sidebar.svg';

export function Logo({ width = 240, height = 96, className, variant = 'login' }: LogoProps) {
  return (
    <img
      className={className}
      src={variant === 'sidebar' ? sidebarLogoUrl : loginLogoUrl}
      width={width}
      height={height}
      alt="蓉易口腔诊所"
    />
  );
}
