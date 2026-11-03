export type RuntimeRole = "api" | "worker" | "all";

/** Local development keeps the combined process; production isolates readers. */
export function parseRuntimeRole(value = process.env.CLARITAS_RUNTIME_ROLE): RuntimeRole {
  const role = value?.trim().toLowerCase() || "all";
  if (role !== "api" && role !== "worker" && role !== "all") {
    throw new Error("CLARITAS_RUNTIME_ROLE must be api, worker, or all.");
  }
  return role;
}

export const runtimeRole = parseRuntimeRole();
export const runsBackgroundWorkers = runtimeRole !== "api";
