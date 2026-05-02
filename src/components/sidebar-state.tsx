import { createContext, useContext } from "react";

export type SidebarStateContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
};

export const SidebarStateContext = createContext<SidebarStateContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useAppSidebar() {
  return useContext(SidebarStateContext);
}
