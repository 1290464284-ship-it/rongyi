import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import { DataTable, LoadingState } from '../../components';
import { errorMessage } from '../../lib/messages';
import { GenerateSection } from '../../schedules/GenerateSection';
import { TemplateSection } from '../../schedules/TemplateSection';
import { weekColumns } from '../../schedules/columns';
import { formatWeekRange, mondayOf } from '../../schedules/format';
import type { ShiftTemplate, UserRow, WeekScheduleRow } from '../../schedules/types';

export function SchedulesPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  const templatesQuery = useQuery({
    queryKey: ['shift-templates'],
    queryFn: () => apiRequest<ShiftTemplate[]>('/shift-templates'),
  });
  const usersQuery = useQuery({
    queryKey: ['schedule-users'],
    queryFn: () => apiRequest<{ items: UserRow[] }>('/resources/users?page=1&pageSize=100'),
  });
  const weekQuery = useQuery({
    queryKey: ['schedules-week', weekStart],
    queryFn: () => apiRequest<WeekScheduleRow[]>(`/schedules/week?weekStart=${weekStart}`),
  });

  const reloadTemplates = () => queryClient.invalidateQueries({ queryKey: ['shift-templates'] });
  const reloadWeek = () => queryClient.invalidateQueries({ queryKey: ['schedules-week'] });

  return (
    <div className="page">
      <div className="page-head"><h1>排班中心</h1></div>
      <TemplateSection templates={templatesQuery.data} reload={reloadTemplates} />
      <GenerateSection
        templates={templatesQuery.data}
        users={usersQuery.data?.items}
        weekStart={weekStart}
        onWeekStartChange={setWeekStart}
        onGenerated={reloadWeek}
      />
      <h2>本周排班（{formatWeekRange(weekStart)}）</h2>
      {weekQuery.isLoading ? <LoadingState /> : weekQuery.error ? <p className="error">{errorMessage(weekQuery.error)}</p> : (
        <DataTable<WeekScheduleRow>
          columns={weekColumns}
          rows={weekQuery.data ?? []}
          keyField="id"
          emptyText="本周暂无排班"
        />
      )}
    </div>
  );
}
