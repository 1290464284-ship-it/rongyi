import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ToothChart } from '../ToothChart';

describe('ToothChart', () => {
  it('渲染牙位图', () => {
    const { container } = render(<ToothChart teeth={[]} selectedTooth={undefined} onSelectTooth={() => {}} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
