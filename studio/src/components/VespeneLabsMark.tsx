import { cn } from 'cn';

import logoMask from '@/assets/vespenelabs-logo-mask.png';

/**
 * The Vespene Labs logo, decolorized: the PNG is an alpha-only mask painted with `currentColor`,
 * so it follows the muted text color in both themes. Pin it to the bottom of a side panel.
 */
export function VespeneLabsMark({ className }: { className?: string }) {
  return (
    <a
      href="https://vespenelabs.pl/"
      target="_blank"
      rel="noreferrer"
      className={cn(
        'mt-auto flex shrink-0 items-center justify-center gap-2 border-t px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        className,
      )}
    >
      <span
        aria-hidden
        className="aspect-264/166 h-4 bg-current"
        style={{
          maskImage: `url(${logoMask})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
        }}
      />
      Vespene Labs
    </a>
  );
}
