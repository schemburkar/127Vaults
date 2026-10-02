// Server composition boundary. Persistence and HTTP transport are intentionally
// deferred until the RB2/RB3 schema migration is reviewed and applied.
export { InMemoryDeviceLifecycleService } from "../../../packages/device-lifecycle/src/index.mjs";
