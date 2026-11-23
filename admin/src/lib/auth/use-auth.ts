import { useSyncExternalStore } from "react";
import { authStore } from "./store";

export function useAuth() {
  return useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
}
