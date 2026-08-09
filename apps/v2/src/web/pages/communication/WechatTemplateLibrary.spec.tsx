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
});
