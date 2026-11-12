const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/board-view.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90)); s = s.replace(a, b); };
// D5 keeps a still running travel of the outer element (a confirm before the piece has arrived)
rep(`      const from = { body: bodyStyle.transform, shadow: shadowStyle.transform, opacity: shadowStyle.opacity };
      stopMoving(rec);
      rec.el.classList.add('is-moving');
      restyle();
      const list = [
        anim(rec.body,`, `      const from = { body: bodyStyle.transform, shadow: shadowStyle.transform, opacity: shadowStyle.opacity };
      // a confirm before the piece has arrived: its flight across the board goes on, only the lift is replaced
      const flight = rec.moving.filter((a) => a.effect instanceof KeyframeEffect && a.effect.target === rec.el);
      for (const a of rec.moving) if (!flight.includes(a)) a.cancel();
      rec.el.classList.add('is-moving');
      restyle();
      const list = [
        ...flight,
        anim(rec.body,`);
rep(`      rec.moving = list;
      settled(list).then(() => { if (rec.moving === list) { rec.moving = []; rec.el.classList.remove('is-moving'); } });
      // the dashed ring turns solid`, `      rec.moving = list;
      settled(list).then(() => {
        if (rec.moving !== list) return;
        rec.moving = [];
        rec.el.style.zIndex = '';
        rec.el.style.willChange = '';
        rec.el.classList.remove('is-moving');
      });
      // the dashed ring turns solid`);
// retract is not in the list of methods that set data-ui-busy (§4.28.1)
rep(`    renderSelection(true);
    return busy(done);
  }`, `    renderSelection(true);
    return done;
  }`);
fs.writeFileSync(p, s);
