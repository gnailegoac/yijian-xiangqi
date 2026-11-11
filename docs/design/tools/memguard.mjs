// Memory guard for scratch scripts and test runs.
// Use:  node --import "file:///<this file>" your-script.mjs        (or set NODE_OPTIONS to that --import)
// A watchdog thread kills the process when its resident memory passes MEM_LIMIT_MB (default 3000). It is a worker
// thread, so it also fires while the main thread is stuck in a synchronous loop. MEM_LOG=<file> logs the size once
// per second. MEMGUARD_OFF=1 switches it off. Worker threads of the guarded process are covered (one process).
import { Worker, isMainThread } from 'node:worker_threads';

if (isMainThread && !process.env.MEMGUARD_OFF) {
  const watchdog = new Worker(new URL('./memguard-worker.cjs', import.meta.url));
  watchdog.unref();
}
