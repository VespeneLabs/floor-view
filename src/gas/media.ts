import type { PipeMedium } from '../model/pipeline';

/**
 * Pipe media for gas installations: `pipeline.medium` ids with an identification color and a
 * typical diameter. Colors follow common practice (yellow for fuel gas, blue for oxygen, cylinder
 * shoulder colors for inert gases) and are picked to stay distinct on screen; they are not a
 * normative marking scheme. Apps with other conventions pass their own `PipeMedium` list.
 */
export const GAS_MEDIA: readonly PipeMedium[] = [
  { id: 'NG', name: 'Natural gas', color: '#facc15', diameter: 0.05 },
  { id: 'LPG', name: 'LPG', color: '#f59e0b', diameter: 0.025 },
  { id: 'H2', name: 'Hydrogen', color: '#dc2626', diameter: 0.015 },
  { id: 'O2', name: 'Oxygen', color: '#2563eb', diameter: 0.015 },
  { id: 'N2', name: 'Nitrogen', color: '#334155', diameter: 0.025 },
  { id: 'Ar', name: 'Argon', color: '#15803d', diameter: 0.015 },
  { id: 'He', name: 'Helium', color: '#92400e', diameter: 0.012 },
  { id: 'CO2', name: 'Carbon dioxide', color: '#6b7280', diameter: 0.015 },
  { id: 'CDA', name: 'Compressed air', color: '#0ea5e9', diameter: 0.025 },
  { id: 'VAC', name: 'Vacuum', color: '#d4d4d8', diameter: 0.05 },
  { id: 'EXH', name: 'Process exhaust', color: '#c2410c', diameter: 0.2 },
];

/** The `GAS_MEDIA` preset with this id, if any. */
export function gasMedium(id: string | undefined): PipeMedium | undefined {
  return id === undefined ? undefined : GAS_MEDIA.find((m) => m.id === id);
}
