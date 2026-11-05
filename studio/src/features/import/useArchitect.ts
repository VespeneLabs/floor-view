import {
  ArchitectController,
  architectBrief,
  createFetchTransport,
  DEFAULT_ARCHITECT_ENDPOINT,
  type ArchitectState,
  type FacilityBrief,
  type Scan,
} from '@vespenelabs/floorview/architect';
import { useEffect, useState, useSyncExternalStore } from 'react';

export type {
  ArchitectChatItem as ChatItem,
  ArchitectProposal as Proposal,
  ArchitectQuestion as Question,
  FacilityBrief as FacilityDetails,
} from '@vespenelabs/floorview/architect';

/**
 * React binding for the library's `ArchitectController`, which runs the assistant's tool loop
 * against Studio's dev-server endpoint (POST /api/architect, see studio/vite.config.ts).
 */
export function useArchitect(scan: Scan | null) {
  const [controller] = useState(() => new ArchitectController({ transport: createFetchTransport({ url: DEFAULT_ARCHITECT_ENDPOINT }) }));
  const state: ArchitectState = useSyncExternalStore(
    (onChange) => controller.on('change', onChange),
    () => controller.getState(),
  );
  // Stop streaming when the page goes away (the controller lives as long as this component).
  useEffect(() => () => controller.stop(), [controller]);

  return {
    ...state,
    /** Start the conversation with the scan and the wizard's answers. */
    start(details: FacilityBrief) {
      if (scan) controller.start(scan, architectBrief(scan, details), `Uploaded “${scan.fileName}” (${details.buildingType}, ${details.floors}).`);
    },
    answer: (answers: Record<string, string>) => controller.answer(answers),
    send: (text: string) => controller.send(text),
    stop: () => controller.stop(),
    retry: () => controller.retry(),
  };
}
