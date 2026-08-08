interface RadioOption {
  value: string;
  label: string;
}

interface RadioProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  disabled?: boolean;
}

export function Radio({ name, value, onChange, options, disabled }: RadioProps) {
  return (
    <div className="ui-radio-row">
      {options.map((option) => (
        <label key={option.value} className="ui-radio">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
