import type { ForgePilotApi } from "../../preload";

declare global {
  interface Window {
    forgepilot: ForgePilotApi;
  }
}
