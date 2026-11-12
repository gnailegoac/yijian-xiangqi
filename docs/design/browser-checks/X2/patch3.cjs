const fs = require('fs');
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/dev/board.html';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90)); s = s.replace(a, b); };
rep(`  hlOff() { view.highlight(null); },`, `  hlOff() { view.highlight(null); },
  async lastMove() {                                         // setLastMove / setCheck called directly, as the stage does after a restore
    await demo.opening();
    const b = createInitialBoard();
    demo.marksOn = !demo.marksOn;
    view.setLastMove(demo.marksOn ? S(b, 2, 7, 2, 4) : null, 'rival');
    const king = S(b, 9, 4, 8, 4).from, attacker = S(b, 2, 7, 2, 4).to;
    view.setCheck(demo.marksOn ? state.bottom : null, [attacker]);
    log('setLastMove + setCheck', demo.marksOn ? 'on' : 'off', king);
  },`);
rep(`button('r-sel', '摇头 nudge', demo.nudge);`, `button('r-sel', '摇头 nudge', demo.nudge);
button('r-sel', '上一步 + 将军圈', demo.lastMove);`);
rep(`    <h1>棋盘实验台 <small>board-view.js · tap the board to play, or run a scene</small></h1>`, `    <h1>棋盘实验台 <small>board-view.js · tap or drag on the board to play, or run a scene · ?fx=real ?audio=real ?bare ?nodeal ?theme= ?bottom= ?motion=reduced</small></h1>`);
fs.writeFileSync(p, s);
