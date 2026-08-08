import { useState, type ReactNode } from 'react';

export interface AccordionItem {
  title: string;
  content: ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
}

export function Accordion({ items }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <div className="ui-accordion">
      {items.map((item, index) => (
        <div key={item.title} className={`ui-accordion-item${openIndex === index ? ' open' : ''}`}>
          <button
            type="button"
            className="ui-accordion-head"
            aria-expanded={openIndex === index}
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
          >
            {item.title}
            <span className="ui-accordion-icon">+</span>
          </button>
          <div className="ui-accordion-body">{item.content}</div>
        </div>
      ))}
    </div>
  );
}
