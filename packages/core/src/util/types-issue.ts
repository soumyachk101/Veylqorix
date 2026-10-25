// Scratch diagnostic file for the types.ts module resolution issue.
// See finding.ts(4,30) and policy.ts(9,8): TS2307 'Cannot find module
// ../types.js' even though traceResolution reports the module as resolved
// and explainFiles lists types.ts as imported by detect.ts and gate/index.ts
// but NOT by finding.ts and policy.ts (which both import ../types.js).
export {};
