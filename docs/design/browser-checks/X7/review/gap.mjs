export default async ({ page }) => {
  const g = await page.evaluate(() => { const u = document.querySelector('#undo-button').getBoundingClientRect(), b = document.querySelector('#board').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(), ub = document.querySelector('#underbar').getBoundingClientRect();
    return { gap: +(u.top - b.bottom).toFixed(2), stageBottomMinusBoard: +(s.bottom - b.bottom).toFixed(2), underTopMinusStage: +(ub.top - s.bottom).toFixed(2), undoInBar: +(u.top - ub.top).toFixed(2), undo: [u.width, u.height] }; });
  console.log('GAP ' + JSON.stringify(g));
};
