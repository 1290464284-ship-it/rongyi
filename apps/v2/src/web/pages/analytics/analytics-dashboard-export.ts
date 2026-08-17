import type { ChartRow } from './analytics-utils';
import { csvCell, downloadTextFile } from '../../lib/csv';

/** 经营分析 CSV 导出：按固定分区顺序拼装行并下载。 */
export function exportAnalyticsCsv(params: {
  revenue: ChartRow[];
  patientGrowth: ChartRow[];
  inventory: ChartRow[];
  satisfaction: ChartRow[];
  doctors: ChartRow[];
  appliedStart: string;
  appliedEnd: string;
}): void {
  const sections: Array<{ title: string; rows: ChartRow[]; columns: Array<{ key: string; label: string }> }> = [
    {
      title: '月度收入',
      rows: params.revenue,
      columns: [
        { key: 'period', label: '期间' },
        { key: 'amount', label: '收入' },
        { key: 'count', label: '单数' },
      ],
    },
    {
      title: '患者增长',
      rows: params.patientGrowth,
      columns: [
        { key: 'day', label: '日期' },
        { key: 'count', label: '新增患者' },
      ],
    },
    {
      title: '库存分类',
      rows: params.inventory,
      columns: [
        { key: 'category', label: '分类' },
        { key: 'count', label: '项目数' },
        { key: 'totalStock', label: '库存总量' },
        { key: 'minStock', label: '最低库存' },
      ],
    },
    {
      title: '满意度趋势',
      rows: params.satisfaction,
      columns: [
        { key: 'surveyDate', label: '日期' },
        { key: 'avgScore', label: '平均分' },
        { key: 'count', label: '问卷数' },
      ],
    },
    {
      title: '医生满意度',
      rows: params.doctors,
      columns: [
        { key: 'doctorName', label: '医生' },
        { key: 'surveyCount', label: '问卷数' },
        { key: 'avgScore', label: '平均分' },
      ],
    },
  ];
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(section.title);
    lines.push(section.columns.map((column) => csvCell(column.label)).join(','));
    for (const row of section.rows) {
      lines.push(section.columns.map((column) => csvCell(row[column.key])).join(','));
    }
    lines.push('');
  }
  downloadTextFile(`经营分析-${params.appliedStart}-${params.appliedEnd}.csv`, lines.join('\n'));
}
