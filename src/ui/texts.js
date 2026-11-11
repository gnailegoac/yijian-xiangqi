// UI-owned Chinese strings: buttons, sheets, banners, popups (SPEC §4.28.8). Package X7.
// Every string is given literally by the contract; do not reword.
// One key of §4.28.8 is gone by owner decision (CONTRACT-NOTES 116): bar.review. #undo-button reads bar.undo in
// every phase, also at game over; 回看 is the conversation history only (bar.history).

export const TXT = {
  bar: { undo: '悔棋', retract: '换一步', confirm: '确定落子', again: '再来一局', history: '回看', retry: '让他再想想' },
  pouch: { label: ['锦囊', '再开一个', '最后一个', '锦囊已开完'],
           aria: ['三个锦囊，还没打开', '第一个锦囊：问一问', '第二个锦囊：看哪里', '第三个锦囊：走哪步'] },
  banner: { start: '开战！', check: '将军！', mate: '绝杀！', stalemate: '困毙！', lose: '惜败，再战！', draw: '握手言和', river: '过河！' },
  popup: { good: '好棋！', great: '妙计！', brilliant: '神来之笔！', lord: '主公英明！', mark: '自己想的' },
  status: { rivalThinking: '对方正在想…', rivalFailed: '司马懿走神了——点一下，让他再想想。',
            engineDead: '棋局的算力没能启动。点一下重试，或者换一个新一点的浏览器（Safari、Chrome、Edge）。' },
  stale: { retract: '已换一步', commit: '已落子' },
  start: { first: '小主公，亮在此恭候多时。这一局，由亮辅佐你。', resume: '小主公回来了！上一局还没下完呢。', again: '小主公，今日再战一局？',
           go: '开战！', cont: '继续上一局', fresh: '新开一局', import: '导入存档', settings: '设置' },
  over: { win: '大获全胜！', loss: '惜败一局', draw: '握手言和',
          sub: { 'win.checkmate': '一招绝杀，小主公威武！', 'win.stalemate': '对方无棋可走，困毙取胜！', loss: '胜败乃兵家常事。小主公，我们再来！',
                 draw: '势均力敌，好一场鏖战。' },
          best: '本局最佳', gains: '这一局的收获',
          /** @param {number} r rounds @param {number} c captures @param {number} b brilliant moves @returns {string} */
          stats: (r, c, b) => `共 ${r} 回合 · 吃子 ${c} · 妙手 ${b}`, again: '再来一局', review: '回看棋局' },
  menu: { newGame: '新对局', notation: '棋谱', settings: '设置', rules: '规则速查', resign: '认输', about: '关于弈间', download: '下载棋谱' },
  settings: { theme: '棋盘主题', themes: { chibi: '赤壁', longzhong: '隆中', shachang: '沙场' }, sfx: '音效', music: '音乐', volume: '音量',
              haptics: '震动反馈', motion: '动态效果', motions: { auto: '跟随系统', full: '完整', reduced: '精简' }, typeTicks: '打字音',
              readAloud: '军师朗读', talk: '军师多说几句', freeText: '可以打字问军师', coach: '军师模式', coaches: { auto: '自动', local: '只用本机' },
              side: '我方执子', sides: { red: '红方先行（蜀）', black: '黑方后行（魏）' }, sideNote: '下一局生效',
              backup: '存档', exportBackup: '导出存档', importBackup: '导入存档', rank: '兵法境界' },
  coachStatus: { llm: '军师状态：云端妙算', local: '军师状态：锦囊妙计（本机）',
                 reason: { no_proxy: '没有找到军师服务（config.json 里没有 apiBase）', no_key: '服务器没有配置密钥（COACH_API_KEY）',
                           origin: '服务器拒绝了这个网址的请求（来源不被允许）', unreachable: '军师服务暂时连不上，稍后会自动重试',
                           setting: '已在设置中选择只用本机', paused: '请求太频繁，稍后恢复', version: '网页和服务器版本不一致，请刷新页面' } },
  dialog: { resign: { title: '确定认输？', body: '这一局就到这里。下一局，我们再来！', keep: '继续对弈', go: '确认认输' },
            newGame: { title: '开始新的对局？', body: '当前这盘棋会被替换。', keep: '继续这盘', go: '开始新对局' } },
  privacy: '和军师说的话会发给 AI 服务来生成回答，请不要写姓名、电话、学校等个人信息。',
  rotate: { text: '把手机竖过来，棋盘更大哦', keep: '继续横屏' },
  rules: [ '红方先行，双方轮流走一步。点一下自己的棋子，亮起的点是能走的位置。',
           '车走直线，不能越子；炮平时同车，吃子时要隔一个炮架。', '马走日，不能蹩马腿；相（象）走田，不能塞象眼，也不能过河。',
           '仕（士）在九宫里斜走一步；帅（将）在九宫里直走一步，两个老将不能照面。', '兵（卒）每次向前一步，过河后可以横走，不能后退。',
           '被将军必须应将。被将死，或者无棋可走（困毙），都算输。', '同一个局面出现三次，算和棋；不能一直将军，得换一招；六十回合没有吃子，也算和棋。' ],
  about: [ '一张棋盘，三十二枚棋子。弈间请来了诸葛亮做你的军师，司马懿在对面等你。',
           '棋局保存在这台设备的浏览器里。清理浏览器数据前，可以在设置里导出存档。' ],
};
