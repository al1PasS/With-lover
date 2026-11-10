import type { components } from "./api/schema";
export type Memory = Omit<components["schemas"]["PrivateMemory"], "deleted"> & {
  deleted?: boolean;
};
export type Anniversary = Omit<
  components["schemas"]["Anniversary"],
  "sortOrder"
> & {
  lunar?: { month: number; day: number };
  dateLabel?: string;
  sortOrder?: number;
};

export type PlaceImage = components["schemas"]["PlaceImage"];
export type Place = Omit<
  components["schemas"]["Place"],
  "image" | "visitDate"
> & {
  image?: PlaceImage | null;
  panoramaImage?: string; // Demo images never use the real media endpoints.
  visitDate?: string | null;
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
