export default async ({ page, shot }) => {
  await page.evaluate(() => {
    document.querySelector('.hud-rotate .hud-btn')?.click();
    __dev.set('over', { canUndo: true });
    const card = __dev.hud.showOver({ ...__dev.overViews.win, goal: '下一盘小目标：出车要趁早，别让大车在家里睡大觉。' });
    card.takeaway.textContent = '大捷！小主公这一局下得真漂亮。第18回合那步捉双最精彩，一下子就赚了一个车。开局出子也很快，三步就把两个马都跳出来了。下一盘小目标：吃子之前，先看看它有没有保镖，再决定吃不吃。亮陪你一起练！';
  });
  await page.waitForTimeout(700);
  console.log('LONG ' + JSON.stringify(await page.evaluate(() => { const c = document.querySelector('dialog[data-dialog="over"]'); const b = c.getBoundingClientRect(); const a = c.querySelector('[data-choice="again"]').getBoundingClientRect(); return { card: [b.y, b.height], scroll: [c.scrollHeight, c.clientHeight], againVisible: a.bottom <= innerHeight && a.top >= b.top, boardVisible: Math.round(b.y - document.querySelector('#board').getBoundingClientRect().y) }; })));
  await shot('long');
};
