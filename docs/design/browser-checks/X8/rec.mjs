// Screencast recorder for steps files: frames of the live page with their time since start().
import { writeFileSync, mkdirSync } from 'node:fs';
export async function recorder(page, dir, prefix) {
  mkdirSync(dir, { recursive: true });
  const client = await page.context().newCDPSession(page);
  const frames = [];
  let t0 = 0, on = false;
  client.on('Page.screencastFrame', (f) => {
    client.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!on) return;
    frames.push({ t: Math.round(f.metadata.timestamp * 1000 - t0), data: f.data });
  });
  return {
    async start() { frames.length = 0; on = true; t0 = Date.now(); await client.send('Page.startScreencast', { format: 'jpeg', quality: 72, everyNthFrame: 1 }); },
    /** Stops and saves the frames nearest to each wanted time (ms since start). */
    async stop(times) {
      on = false;
      await client.send('Page.stopScreencast').catch(() => {});
      const base = frames.length ? frames[0].t : 0;
      const out = [];
      const picks = times ?? frames.map((f) => f.t - base);
      for (const want of picks) {
        let best = null;
        for (const f of frames) if (!best || Math.abs(f.t - base - want) < Math.abs(best.t - base - want)) best = f;
        if (!best) continue;
        const file = `${dir}/${prefix}-${String(want).padStart(5, '0')}ms.jpg`;
        writeFileSync(file, Buffer.from(best.data, 'base64'));
        out.push(file);
      }
      return { files: out, count: frames.length, span: frames.length ? frames[frames.length - 1].t - base : 0 };
    },
  };
}
