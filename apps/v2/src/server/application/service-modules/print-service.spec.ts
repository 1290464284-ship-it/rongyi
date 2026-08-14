// PrintService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import { describe, expect, it } from 'vitest';
import { PrintService } from '../print-service';

describe('PrintService', () => {
  it('renders report templates with optional title and note', () => {
    const print = new PrintService();
    expect(print.render('report', { title: 'Title', note: 'Note' })).toContain('Title');
    expect(print.render('report', { note: 'Note' })).toContain('report');
  });
});
