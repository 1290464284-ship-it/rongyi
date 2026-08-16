import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

interface KanbanCard {
  id: string;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

interface KanbanBoardProps {
  columns: KanbanColumn[];
  onChange?: (columns: KanbanColumn[]) => void;
}

export function KanbanBoard({ columns, onChange }: KanbanBoardProps) {
  const [items, setItems] = useState<KanbanColumn[]>(columns);
  const visibleColumns = onChange ? columns : items;

  function allowDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
  }

  function leaveDrop(event: DragEvent<HTMLDivElement>) {
    event.currentTarget.classList.remove('drag-over');
  }

  function drop(event: DragEvent<HTMLDivElement>, columnId: string) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const cardId = event.dataTransfer.getData('text/plain');
    const next = moveCard(visibleColumns, cardId, columnId);
    if (!next) return;
    if (onChange) onChange(next);
    else setItems(next);
  }

  function moveByKeyboard(cardId: string, delta: number) {
    const sourceIndex = visibleColumns.findIndex((column) => column.cards.some((card) => card.id === cardId));
    const targetIndex = sourceIndex + delta;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= visibleColumns.length) return;
    const next = moveCard(visibleColumns, cardId, visibleColumns[targetIndex].id);
    if (!next) return;
    if (onChange) onChange(next);
    else setItems(next);
  }

  return (
    <div className="ui-kanban">
      {visibleColumns.map((column) => (
        <div
          key={column.id}
          className="ui-kanban-col"
          role="list"
          aria-label={column.title}
          onDragOver={allowDrop}
          onDragLeave={leaveDrop}
          onDrop={(event) => drop(event, column.id)}
        >
          <div className="ui-kanban-head"><strong>{column.title}</strong><span>{column.cards.length}</span></div>
          {column.cards.map((card) => (
            <div
              key={card.id}
              className="ui-kanban-card"
              draggable
              tabIndex={0}
              role="listitem"
              aria-label={`卡片 ${card.title}`}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveByKeyboard(card.id, 1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveByKeyboard(card.id, -1);
                }
              }}
            >
              <strong>{card.title}</strong>
              {card.subtitle && <span>{card.subtitle}</span>}
              {card.footer}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function moveCard(columns: KanbanColumn[], cardId: string, targetColumnId: string): KanbanColumn[] | null {
  const source = columns.find((column) => column.cards.some((card) => card.id === cardId));
  const card = source?.cards.find((item) => item.id === cardId);
  if (!source || !card || source.id === targetColumnId) return null;
  return columns.map((column) => {
    if (column.id === source.id) return { ...column, cards: column.cards.filter((item) => item.id !== cardId) };
    if (column.id === targetColumnId) return { ...column, cards: [...column.cards, card] };
    return column;
  });
}
