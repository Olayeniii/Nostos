export const evidenceClasses = [
  "real",
  "local_test",
  "simulated",
  "planned",
  "not_supported",
] as const;

export type EvidenceClass = (typeof evidenceClasses)[number];
