import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';

/**
 * An input that commits on the native `change` event (blur, Enter, closing a color picker),
 * not on every keystroke, so each edit is a single undo step. It resets when `value` changes.
 */
export function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string | number;
  onCommit: (value: string) => void;
}) {
  return (
    <Input
      key={String(value)}
      defaultValue={value}
      ref={(el) => {
        if (!el) return;
        const commit = () => onCommit(el.value);
        el.addEventListener('change', commit);
        return () => el.removeEventListener('change', commit);
      }}
      {...props}
    />
  );
}
