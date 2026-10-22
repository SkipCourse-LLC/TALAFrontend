import { createContext, useContext } from "react";

// The workspace stays mounted to keep unsent files; close native dialogs when records are hidden.
export const WorkspaceVisibility = createContext(true);
export function useWorkspaceVisible() {
  return useContext(WorkspaceVisibility);
}
