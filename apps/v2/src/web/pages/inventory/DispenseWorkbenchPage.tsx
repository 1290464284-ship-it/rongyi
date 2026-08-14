import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { DispenseCreateForm } from '../../dispense/DispenseCreateForm';
import { DispenseListPanel } from '../../dispense/DispenseListPanel';
import { DispenseNarcoticPanel } from '../../dispense/DispenseNarcoticPanel';
import type { DispenseRow } from '../../dispense/types';

/**
 * 药房工作台：发药单列表与发药/退药操作、新建发药单、麻药登记。
 *
 * 发药/退药以行内面板展开，面板内按明细选择批次（仅批次管理物品）或填写退回数量；
 * 所有提交成功后刷新列表并给出 Toast 反馈。
 */
export function DispenseWorkbenchPage() {
  const [dispensePage, setDispensePage] = useState(1);

  const dispenses = useQuery({
    queryKey: ['dispenses', dispensePage],
    queryFn: () => apiRequest<Page<DispenseRow>>(`/dispenses?page=${dispensePage}&pageSize=20`),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>药房工作台</h1>
      </div>

      <DispenseListPanel
        dispenses={dispenses}
        dispensePage={dispensePage}
        setDispensePage={setDispensePage}
      />
      <DispenseCreateForm onCreated={() => void dispenses.refetch()} />
      <DispenseNarcoticPanel />
    </div>
  );
}
