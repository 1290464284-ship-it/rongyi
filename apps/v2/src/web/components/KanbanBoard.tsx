import { useState, type DragEvent } from 'react';

interface KanbanCard {
  id: string;
  title: string;
  subtitle?: string;
}

interface KanbanColumn {
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

  return (
    <div className="ui-kanban">
      {visibleColumns.map((column) => (
        <div
          key={column.id}
          className="ui-kanban-col"
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
              onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
            >
              <strong>{card.title}</strong>
              {card.subtitle && <span>{card.subtitle}</span>}
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
