// XD: prints the peak resident size of this process when it exits (import it before the test file).
let peak = 0;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 20);
timer.unref();
process.on('exit', () => { peak = Math.max(peak, process.memoryUsage.rss()); console.log(`XDPEAK rss ${(peak / 1048576).toFixed(0)} MB`); });
