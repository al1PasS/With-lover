import type { components } from "./api/schema";
export type Memory = Omit<components["schemas"]["PrivateMemory"], "deleted"> & {
  deleted?: boolean;
};
export type Anniversary = Omit<components["schemas"]["Anniversary"], "sortOrder"> & {
  lunar?: { month: number; day: number };
  dateLabel?: string;
  sortOrder?: number;
};

export type Place = {
  id: string;
  city: string;
  panoramaImage: string;
  visitDate?: string;
  description: string;
  sortOrder: number;
};

export type PrivacyPolicy = {
  mode: "PRIVATE" | "SELECTED";
  home: boolean;
  timeline: boolean;
  anniversaries: boolean;
  albums: boolean;
  places: boolean;
};

export const defaultPrivacy: PrivacyPolicy = {
  mode: "SELECTED",
  home: true,
  timeline: true,
  anniversaries: false,
  albums: false,
  places: false,
};

export function visitorCanView(
  policy: PrivacyPolicy,
  module: Exclude<keyof PrivacyPolicy, "mode">,
) {
  return policy.mode === "SELECTED" && policy[module];
}
