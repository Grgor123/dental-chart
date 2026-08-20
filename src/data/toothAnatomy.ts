import type { Arch, ToothPosition } from './toothMeta';

export interface ToothAnatomy {
  /** Average incisal/occlusal edge to CEJ (gumline) distance, mm */
  crownLengthMm: number;
  /** Average CEJ to root apex distance, mm */
  rootLengthMm: number;
}

// Typical adult permanent-tooth dimensions, standard dental anatomy
// references (e.g. Wheeler's Dental Anatomy). These are textbook averages
// for a visual chart, not measurements of any real patient — real teeth
// vary by several mm from these figures. Drives the side-view sizing model
// in toothProfiles.ts so every tooth's on-screen size is anchored to a real
// unit (mm) instead of an arbitrary photo-crop pixel count.
export const TOOTH_ANATOMY_MM: Record<Arch, Record<ToothPosition, ToothAnatomy>> = {
  upper: {
    incisor_central: { crownLengthMm: 10.5, rootLengthMm: 13.0 },
    incisor_lateral: { crownLengthMm: 9.0, rootLengthMm: 13.0 },
    canine: { crownLengthMm: 10.0, rootLengthMm: 17.0 },
    premolar1: { crownLengthMm: 8.5, rootLengthMm: 14.0 },
    premolar2: { crownLengthMm: 8.5, rootLengthMm: 14.0 },
    molar1: { crownLengthMm: 7.5, rootLengthMm: 12.0 },
    molar2: { crownLengthMm: 7.0, rootLengthMm: 11.0 },
    molar3: { crownLengthMm: 6.5, rootLengthMm: 11.0 },
  },
  lower: {
    incisor_central: { crownLengthMm: 9.0, rootLengthMm: 12.5 },
    incisor_lateral: { crownLengthMm: 9.5, rootLengthMm: 14.0 },
    canine: { crownLengthMm: 11.0, rootLengthMm: 15.5 },
    premolar1: { crownLengthMm: 8.5, rootLengthMm: 14.0 },
    premolar2: { crownLengthMm: 8.0, rootLengthMm: 14.5 },
    molar1: { crownLengthMm: 7.5, rootLengthMm: 14.0 },
    molar2: { crownLengthMm: 7.0, rootLengthMm: 13.0 },
    molar3: { crownLengthMm: 7.0, rootLengthMm: 11.0 },
  },
};
