import { useState, type DragEvent } from 'react';

export interface KanbanCard {
  id: string;
  title: string;
  subtitle?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

interface KanbanBoardProps {
  columns: KanbanColumn[];
}

export function KanbanBoard({ columns }: KanbanBoardProps) {
  const [items, setItems] = useState<KanbanColumn[]>(columns);

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
    setItems((current) => current.map((column) => {
      const card = column.cards.find((item) => item.id === cardId);
      if (card && column.id !== columnId) {
        return {
          ...column,
          cards: column.cards.filter((item) => item.id !== cardId),
        };
      }
      return column;
    }).map((column) => {
      if (column.id !== columnId) return column;
      const source = items.flatMap((col) => col.cards).find((card) => card.id === cardId);
      if (!source || column.cards.some((card) => card.id === cardId)) return column;
      return { ...column, cards: [...column.cards, source] };
    }));
  }

  return (
    <div className="ui-kanban">
      {items.map((column) => (
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
