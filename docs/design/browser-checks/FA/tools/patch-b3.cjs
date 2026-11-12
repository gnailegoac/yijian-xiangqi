const fs = require('fs');
let s = fs.readFileSync('browser3.mjs', 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('anchor ' + a.slice(0, 50)); s = s.replace(a, () => b); };
// a Worker double: the answer of his first job is turned into the mating move (4,7) -> (4,4)
rep(`      await page.addInitScript(record);`, `      await page.addInitScript(record);
      await page.addInitScript(() => {
        const Real = window.Worker;
        class Double {
          constructor(url, options) {
            this.onmessage = null; this.onerror = null; this.onmessageerror = null;
            this.opp = new Set();
            this.real = new Real(url, options);
            this.real.onmessage = (event) => {
              const d = event.data;
              if (d && d.t === 'done' && this.opp.has(d.id) && d.data && d.data.move) {
                const from = { row: 4, col: 7 }, to = { row: 4, col: 4 };
                d.data.move = { ...d.data.move, from, to, captured: null };
                if (d.data.choice) d.data.choice.move = { from, to };
              }
              if (this.onmessage) this.onmessage({ data: d });
            };
            this.real.onerror = (event) => { if (this.onerror) this.onerror(event); };
          }
          postMessage(message) {
            if (message && message.t === 'job' && message.kind === 'opponent' && message.payload && message.payload.ply === 7) this.opp.add(message.id);
            this.real.postMessage(message);
          }
          terminate() { this.real.terminate(); }
          addEventListener() {}
          removeEventListener() {}
        }
        window.Worker = Double;
      });`);
rep(`for (let seed = 1; seed <= 12 && !done; seed++) {`, `for (let seed = 1; seed <= 2 && !done; seed++) {`);
fs.writeFileSync('browser3.mjs', s);
console.log('browser3 patched');
