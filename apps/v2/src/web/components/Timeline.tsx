export interface TimelineItem {
  title: string;
  time?: string;
  description?: string;
  tone?: 'done' | 'current' | 'pending';
}

interface TimelineProps {
  items: TimelineItem[];
}

export function Timeline({ items }: TimelineProps) {
  return (
    <div className="ui-timeline">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className={`ui-timeline-item ${item.tone ?? ''}`}>
          <span className="ui-timeline-dot" />
          <div>
            <strong>{item.title}</strong>
            {item.description && <p>{item.description}</p>}
            {item.time && <span>{item.time}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
