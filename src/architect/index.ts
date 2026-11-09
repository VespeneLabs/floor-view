/**
 * `@vespenelabs/floorview/architect`: the browser side of the AI floor plan assistant, without
 * React. `ArchitectController` runs the tool loop over a pluggable transport; `prepareScan`
 * readies an uploaded drawing; `convertProposal` turns a model proposal into a validated plan.
 * The server side is `@vespenelabs/floorview/architect/server`.
 */
export * from './protocol';
export { createFetchTransport, readNdjson, ArchitectTransportError } from './transport';
export type { ArchitectTransport, FetchTransportOptions } from './transport';
export { ArchitectController, architectBrief } from './controller';
export type {
  ArchitectActivity,
  ArchitectChatItem,
  ArchitectControllerEvents,
  ArchitectControllerOptions,
  ArchitectProposal,
  ArchitectQuestion,
  ArchitectState,
  ArchitectStatus,
  FacilityBrief,
  PreviewRenderer,
} from './controller';
export { convertProposal } from './conversion';
export type { ConvertProposalOptions, ImageSize, ProposalAsset, ProposalConversion } from './conversion';
export { ACCEPTED_SCAN_TYPES, prepareScan, renderProposalOverlay } from './scan';
export type { Scan } from './scan';
