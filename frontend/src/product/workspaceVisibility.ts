import { createContext, useContext } from "react";

// The workspace can stay mounted to retain a private, unsent File in memory.
// Native dialogs must leave the top layer whenever its records are concealed.
export const WorkspaceVisibility = createContext(true);
export function useWorkspaceVisible() {
  return useContext(WorkspaceVisibility);
}
