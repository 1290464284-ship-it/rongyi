import { EmptyState, LoadingState } from '../components';
import { formatMoney } from '../lib/format';
import { errorMessage } from '../lib/messages';
import type { ChargeTreeNode } from './charge-types';

export function ChargeTreePanel({
  isLoading,
  error,
  items,
  expandedCatalogs,
  onToggleCatalog,
  onQuickCharge,
}: {
  isLoading: boolean;
  error: unknown;
  items: ChargeTreeNode[];
  expandedCatalogs: Record<string, boolean>;
  onToggleCatalog: (id: string) => void;
  onQuickCharge: (node: ChargeTreeNode) => void;
}) {
  function renderCatalogNode(node: ChargeTreeNode, depth: number) {
    if (node.children.length === 0) {
      return (
        <li className="catalog-leaf" key={node.id} style={{ paddingLeft: 8 + depth * 18 }}>
          <button type="button" aria-label={`快捷划价 ${node.name}`} onClick={() => onQuickCharge(node)}>
            {node.name} · {formatMoney(node.price)}
          </button>
          {node.costType === 'MATERIAL' && <span className="catalog-tag">材料</span>}
        </li>
      );
    }
    const expanded = expandedCatalogs[node.id] ?? false;
    return (
      <li className="catalog-branch" key={node.id}>
        <button
          type="button"
          aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
          onClick={() => onToggleCatalog(node.id)}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {expanded ? '▾' : '▸'} {node.name} · {formatMoney(node.price)}
        </button>
        {expanded && <ul>{node.children.map((child) => renderCatalogNode(child, depth + 1))}</ul>}
      </li>
    );
  }

  return isLoading ? (
    <LoadingState label="收费项目加载中..." />
  ) : error ? (
    <p className="error">{errorMessage(error, '收费项目加载失败')}</p>
  ) : items.length === 0 ? (
    <EmptyState message="暂无收费项目" />
  ) : (
    <ul className="charge-tree">{items.map((node) => renderCatalogNode(node, 0))}</ul>
  );
}
