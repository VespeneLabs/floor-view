import { parsePlanJSON, type FloorPlan } from '@vespenelabs/floorview';

const STORAGE_KEY = 'vespenelabs.plan';

/** The plan saved in this browser, or null if there is none, it is invalid or storage is blocked. */
export function loadStoredPlan(): FloorPlan | null {
  try {
    const json = window.localStorage.getItem(STORAGE_KEY);
    return json ? parsePlanJSON(json) : null;
  } catch {
    return null;
  }
}

/** Best-effort autosave; storage may be blocked or full. */
export function storePlan(plan: FloorPlan): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Ignore: the plan stays in memory and can still be exported.
  }
}
