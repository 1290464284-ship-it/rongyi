import { code39Bars, barcodeDimensions, sanitizeCode39 } from './barcode';

export function BarcodeView({ value, height = 56 }: { value: string; height?: number }) {
  const bars = code39Bars(value);
  const { width } = barcodeDimensions(bars);
  const scale = height / 56;
  return (
    <svg
      role="img"
      aria-label={`条码 ${sanitizeCode39(value) || value}`}
      width={Math.ceil(width * scale)}
      height={height}
      viewBox={`0 0 ${width} ${56}`}
      className="barcode-svg"
    >
      {bars.map((bar, index) => (
        <rect key={index} x={bar.x} y={0} width={bar.width} height={56} fill="currentColor" />
      ))}
    </svg>
  );
}
