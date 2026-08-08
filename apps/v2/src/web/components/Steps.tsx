interface StepItem {
  label: string;
}

interface StepsProps {
  current: number;
  items: StepItem[];
  onChange?: (index: number) => void;
}

export function Steps({ current, items, onChange }: StepsProps) {
  return (
    <div className="ui-steps">
      {items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          className={`ui-step${index < current ? ' done' : ''}${index === current ? ' active' : ''}`}
          onClick={() => onChange?.(index)}
        >
          <span className="ui-step-dot">{index + 1}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
