// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '../../components/toast';
import { WechatTemplateLibrary, type WechatTemplateConfig } from './WechatTemplateLibrary';

const writeText = vi.fn().mockResolvedValue(undefined);

function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('WechatTemplateLibrary', () => {
  afterEach(() => {
    cleanup();
    writeText.mockClear();
  });

  it('renders the three built-in message templates', () => {
    render(<WechatTemplateLibrary config={{ enabled: true }} />, { wrapper });
    expect(screen.getByText('预约提醒')).toBeDefined();
    expect(screen.getByText('治疗回访')).toBeDefined();
    expect(screen.getByText('首诊跟进')).toBeDefined();
  });

  it('uses default content when no config is provided', () => {
    render(<WechatTemplateLibrary />, { wrapper });
    expect(screen.getByText('{patientName}您好，您明天 {appointmentTime} 预约了复诊，请按时到诊；如需调整时间请提前联系诊所。')).toBeDefined();
    expect(screen.getByText('{patientName}您好，您上次治疗已过去 {days} 天，恢复情况怎么样？如有不适请及时联系我们。')).toBeDefined();
    expect(screen.getByText('{patientName}您好，上次您来诊所咨询后，不知您考虑得怎么样了？如需进一步了解治疗方案，欢迎随时联系我们。')).toBeDefined();
  });

  it('copies the configured appointment content', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const config: WechatTemplateConfig = {
      enabled: true,
      appointmentContent: '{patientName}您好，您的预约时间是 {appointmentTime}。',
    };
    render(<WechatTemplateLibrary config={config} />, { wrapper });
    fireEvent.click(screen.getAllByRole('button', { name: '复制模板' })[0]);
    expect(writeText).toHaveBeenCalledWith(config.appointmentContent);
  });

  it('reports copy failures', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    });
    render(<WechatTemplateLibrary config={{ enabled: true }} />, { wrapper });
    fireEvent.click(screen.getAllByRole('button', { name: '复制模板' })[0]);
    expect(await screen.findByText('复制失败，请手动选择复制')).toBeDefined();
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalDescriptor);
    }
  });

  it('renders sample text with placeholders and falls back to defaults', () => {
    render(<WechatTemplateLibrary config={{ appointmentContent: '  {patientName}您好，请准时。  ' }} />, { wrapper });
    expect(screen.getByText('{patientName}您好，请准时。')).toBeDefined();
    expect(screen.getByText('张女士您好，请准时。')).toBeDefined();
    expect(screen.getByText(/李先生您好/)).toBeDefined();
    expect(screen.getByText(/王女士您好/)).toBeDefined();
  });

  it('falls back to built-in content when the configured content is empty', () => {
    render(<WechatTemplateLibrary config={{ appointmentContent: '   ', recallContent: '' }} />, { wrapper });
    expect(screen.getByText('{patientName}您好，您明天 {appointmentTime} 预约了复诊，请按时到诊；如需调整时间请提前联系诊所。')).toBeDefined();
    expect(screen.getByText('{patientName}您好，您上次治疗已过去 {days} 天，恢复情况怎么样？如有不适请及时联系我们。')).toBeDefined();
  });
});
