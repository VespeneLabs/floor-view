import { GAS_MEDIA, gasMedium, type PipeMedium } from '@vespenelabs/floorview/gas';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '';

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-3 shrink-0 rounded-full border border-foreground/20" style={{ background: color }} />;
}

/**
 * Pick a pipe medium from the Gas kit presets (`GAS_MEDIA`), or none. A medium that is not a
 * preset (set through the API or an imported plan) stays selectable as itself.
 */
export function MediumSelect({
  id,
  value,
  onChange,
  size = 'default',
  className,
}: {
  id?: string;
  value: string | undefined;
  onChange: (medium: PipeMedium | null, id: string | undefined) => void;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const custom = value && !gasMedium(value) ? value : undefined;
  const items = [
    { value: NONE, label: 'No medium' },
    ...GAS_MEDIA.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })),
    ...(custom ? [{ value: custom, label: custom }] : []),
  ];

  return (
    <Select
      items={items}
      value={value ?? NONE}
      onValueChange={(v) => {
        const next = typeof v === 'string' && v !== NONE ? v : undefined;
        onChange(gasMedium(next) ?? null, next);
      }}
    >
      <SelectTrigger id={id} size={size} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-56">
        <SelectItem value={NONE}>No medium</SelectItem>
        {GAS_MEDIA.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <Swatch color={m.color} />
            <span className="flex-1">{m.name}</span>
            <span className="text-muted-foreground">{m.id}</span>
          </SelectItem>
        ))}
        {custom && <SelectItem value={custom}>{custom}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
