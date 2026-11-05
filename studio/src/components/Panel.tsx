import { cn } from 'cn';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';

/** A titled card that hosts a full-bleed canvas (editor or viewer) or a form. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('min-h-88 gap-0 overflow-hidden py-0 lg:min-h-0', className)}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}
