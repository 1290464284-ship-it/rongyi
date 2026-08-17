import { useState } from 'react';

export interface TreeNode {
  id: string;
  label: string;
  badge?: string;
  badgeTone?: 'neutral' | 'warning' | 'success' | 'danger';
  meta?: string;
  action?: string;
  actionAriaLabel?: string;
  children?: TreeNode[];
}

interface TreeProps {
  nodes: TreeNode[];
  selectedId?: string | null;
  expandedIds?: Record<string, boolean>;
  onToggle?: (id: string) => void;
  onSelect?: (id: string) => void;
  onAction?: (node: TreeNode) => void;
}

function TreeNodeView({
  node,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onAction,
  openIds,
  toggle,
}: {
  node: TreeNode;
  selectedId?: string | null;
  expandedIds?: Record<string, boolean>;
  onToggle?: (id: string) => void;
  onSelect?: (id: string) => void;
  onAction?: (node: TreeNode) => void;
  openIds: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const open = expandedIds ? Boolean(expandedIds[node.id]) : openIds.has(node.id);

  function handleToggle() {
    /* v8 ignore next -- 展开按钮仅在有子节点时渲染，无子节点分支不可达，防御冗余 */
    if (!hasChildren) return;
    if (expandedIds && onToggle) onToggle(node.id);
    else toggle(node.id);
  }

  return (
    <div className="ui-tree-node">
      <div
        className={`ui-tree-item${selectedId === node.id ? ' selected' : ''}`}
      >
        {hasChildren && (
          <button
            type="button"
            className="ui-tree-toggle"
            onClick={handleToggle}
            aria-expanded={open}
            aria-label={open ? `收起 ${node.label}` : `展开 ${node.label}`}
          >
            {open ? '▼' : '+'}
          </button>
        )}
        <span
          className="ui-tree-label"
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.(node.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.(node.id);
            }
          }}
        >
          {node.label}
        </span>
        {node.badge && <span className={`ui-badge ${node.badgeTone ?? 'neutral'}`}>{node.badge}</span>}
        {node.meta && <span className="ui-tree-meta">{node.meta}</span>}
        {node.action && (
          <button
            type="button"
            className="ui-tree-action"
            aria-label={node.actionAriaLabel}
            onClick={(event) => {
              event.stopPropagation();
              onAction?.(node);
            }}
          >
            {node.action}
          </button>
        )}
      </div>
      {hasChildren && open && (
        <div className="ui-tree-children">
          {node.children!.map((child) => (
            <TreeNodeView
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onAction={onAction}
              openIds={openIds}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Tree({
  nodes,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onAction,
}: TreeProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="ui-tree">
      {nodes.map((node) => (
        <TreeNodeView
          key={node.id}
          node={node}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
          onAction={onAction}
          openIds={openIds}
          toggle={toggle}
        />
      ))}
    </div>
  );
}
