// Composition root (SPEC 4.27). Owner: A1.
//
// F0 stub. This is the entry module of index.html (<script type="module" src="./src/app.js">), so it must load
// without throwing while every other module is still a stub. It therefore imports nothing and does nothing on
// load: it does not create the session, the worker or the stage, and it does not set html[data-ready="1"]
// (that attribute means "the game booted" and is A1's done-criterion).
//
// The module has no exports: SPEC 4.27 defines a boot sequence, not an API. Package A1 replaces this file with
// the boot order of SPEC 4.27:
//    1. cfgPromise = loadConfig()
//    2. loaded = store.load()
//    3. stage = createStage(document.getElementById('app'), { settings, url: location })
//    4. tasks = createTasks({ getScope, createWorker, onWorker })
//    5. session = createSession();  brain = createBrainPort()
//    6. session.subscribe(scope -> tasks.sync)                        always first
//    7. config = await cfgPromise;  coach = createCoachPort(...)
//    8. save, director = createDirector(...);  session.subscribe(save);  session.subscribe(director.onEvent);
//       stage.on(director.actions)
//    9. choice = stage.start(...)  (skipped with ?test=1)
//   10. director.loadExtras(...);  session.restore(...) | session.newGame(...)
//   11. director.notices(...)
//   12. listeners: visibilitychange, online, prefers-reduced-motion, error / unhandledrejection
//   13. coach.probe();  document.documentElement.dataset.ready = '1'

export {};
