import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ErrorBoundary } from '../ErrorBoundary';

describe('ErrorBoundary', () => {
  it('渲染子组件', () => {
    render(
      <ErrorBoundary>
        <div>测试内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('测试内容')).toBeInTheDocument();
  });
});
