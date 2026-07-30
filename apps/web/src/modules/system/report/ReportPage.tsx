import React, { useState } from 'react';
import { Select } from '@/components/ui/select';
import { format, subDays, subMonths } from 'date-fns';
import RevenueTab from './tabs/RevenueTab';
import PatientGrowthTab from './tabs/PatientGrowthTab';
import RevenueCategoryTab from './tabs/RevenueCategoryTab';
import RevenueDoctorTab from './tabs/RevenueDoctorTab';
import InventoryTab from './tabs/InventoryTab';
import AppointmentTab from './tabs/AppointmentTab';
import MemberTab from './tabs/MemberTab';

type TabKey =
  | 'revenue'
  | 'patientGrowth'
  | 'revenueCategory'
  | 'revenueDoctor'
  | 'inventory'
  | 'appointment'
  | 'member';

const ReportPage = React.memo(function ReportPage() {
  const [tab, setTab] = useState<TabKey>('revenue');
  const today = new Date();
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('day');

  const startDate =
    range === 'week'
      ? format(subDays(today, 7), 'yyyy-MM-dd')
      : range === 'month'
        ? format(subMonths(today, 1), 'yyyy-MM-dd')
        : format(new Date(today.getFullYear(), 0, 1), 'yyyy-MM-dd');
  const endDate = format(today, 'yyyy-MM-dd');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'revenue', label: '收入趋势' },
    { key: 'patientGrowth', label: '患者增长' },
    { key: 'revenueCategory', label: '收入分类分析' },
    { key: 'revenueDoctor', label: '收入医生分布' },
    { key: 'inventory', label: '库存状态' },
    { key: 'appointment', label: '预约统计' },
    { key: 'member', label: '会员统计' },
  ];

  const dateRange = { startDate, endDate };

  return (
    <div className='p-6 space-y-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>经营报表</h1>
        <div className='flex items-center gap-3'>
          <Select
            value={range}
            onChange={(e) => {
              const v = e.target.value as 'week' | 'month' | 'year';
              setRange(v);
              setGroupBy(v === 'year' ? 'month' : 'day');
            }}
            className='w-32'
          >
            <option value='week'>近一周</option>
            <option value='month'>近一月</option>
            <option value='year'>本年度</option>
          </Select>
        </div>
      </div>

      <div className='flex items-center gap-1 border-b border-border overflow-x-auto'>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue' && (
        <RevenueTab startDate={startDate} endDate={endDate} groupBy={groupBy} setGroupBy={setGroupBy} />
      )}
      {tab === 'patientGrowth' && <PatientGrowthTab dateRange={dateRange} />}
      {tab === 'revenueCategory' && <RevenueCategoryTab dateRange={dateRange} />}
      {tab === 'revenueDoctor' && <RevenueDoctorTab dateRange={dateRange} />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'appointment' && <AppointmentTab dateRange={dateRange} />}
      {tab === 'member' && <MemberTab />}
    </div>
  );
});
export default ReportPage;
