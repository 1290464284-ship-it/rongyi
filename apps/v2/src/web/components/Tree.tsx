import { useState } from 'react';

interface TreeNode {
  id: string;
  label: string;
  badge?: string;
  children?: TreeNode[];
}

interface TreeProps {
  nodes: TreeNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

function TreeNodeView({
  node,
  depth,
  selectedId,
  onSelect,
  openIds,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  openIds: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const open = openIds.has(node.id);
  return (
    <div className="ui-tree-node">
      <div
        className={`ui-tree-item${selectedId === node.id ? ' selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <button
          type="button"
          className="ui-tree-toggle"
          onClick={() => hasChildren && toggle(node.id)}
          aria-expanded={open}
        >
          {hasChildren ? (open ? '−' : '+') : ''}
        </button>
        <span className="ui-tree-label" onClick={() => onSelect?.(node.id)}>{node.label}</span>
        {node.badge && <span className="tag">{node.badge}</span>}
      </div>
      {hasChildren && open && (
        <div className="ui-tree-children">
          {node.children!.map((child) => (
            <TreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              openIds={openIds}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Tree({ nodes, selectedId, onSelect }: TreeProps) {
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
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          openIds={openIds}
          toggle={toggle}
        />
      ))}
    </div>
  );
}
