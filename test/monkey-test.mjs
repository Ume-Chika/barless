// test/monkey-test.mjs - ランダム操作による耐久モンキーテスト

import { createMockChrome } from './mock-chrome.js';

const mock = createMockChrome();
globalThis.chrome = mock;

const splitModule = await import('../js/background-split.js');
const { openSplitTabs, unsplitAndActivate, reconcileCheckedOutTabs, getCheckedOutTabs } = splitModule;

const INITIAL_TABS = [
  { id: 1, title: 'Tab A', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://a.com' },
  { id: 2, title: 'Tab B', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://b.com' },
  { id: 3, title: 'Tab C', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://c.com' },
  { id: 4, title: 'Tab D', groupId: 20, windowId: 1, splitViewId: -1, url: 'https://d.com' },
  { id: 5, title: 'Tab E', groupId: -1, windowId: 1, splitViewId: -1, url: 'https://e.com' }
];

const INITIAL_GROUPS = [
  { id: 10, title: 'Group A', color: 'blue', windowId: 1 },
  { id: 20, title: 'Group B', color: 'red', windowId: 1 }
];

async function assertInvariants(stepNum, actionName) {
  const currentTabs = mock._debug.getTabs();
  const currentGroups = mock._debug.getGroups();
  const checkedOut = await getCheckedOutTabs();

  // 1. 各グループの連続性
  const groupIndices = {};
  for (const t of currentTabs) {
    if (t.groupId && t.groupId !== -1) {
      if (!groupIndices[t.groupId]) groupIndices[t.groupId] = [];
      groupIndices[t.groupId].push(t.index);
    }
  }

  for (const [gidStr, indices] of Object.entries(groupIndices)) {
    const gid = parseInt(gidStr, 10);
    indices.sort((a, b) => a - b);
    for (let i = 0; i < indices.length - 1; i++) {
      if (indices[i + 1] !== indices[i] + 1) {
        throw new Error(
          `[FAIL Step ${stepNum}: ${actionName}] グループ ${gid} が分断されています！ indices: ${indices.join(', ')}\n` +
          `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
        );
      }
    }
  }

  // 2. 出張中でないのに所属グループが狂っていないか
  // タブ E は常にグループ外（または出張中）
  const tabE = currentTabs.find(t => t.id === 5);
  if (tabE && !checkedOut[5] && tabE.groupId !== -1) {
    throw new Error(
      `[FAIL Step ${stepNum}: ${actionName}] 所属なしタブ E が勝手にグループ ${tabE.groupId} に編入されています！\n` +
      `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
    );
  }

  // タブ D はグループ 20（または消滅再生成グループ）のみ
  const tabD = currentTabs.find(t => t.id === 4);
  if (tabD && !checkedOut[4] && tabD.groupId !== -1) {
    const groupD = currentGroups.find(g => g.id === tabD.groupId);
    if (groupD && groupD.title !== 'Group B') {
      throw new Error(
        `[FAIL Step ${stepNum}: ${actionName}] タブ D が別のグループ ${groupD.title} に混入しています！\n` +
        `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
      );
    }
  }

  // 3. グループ自体の相対順序（Group A が常に Group B より前にあること）
  const groupATabs = currentTabs.filter(t => !checkedOut[t.id] && t.groupId !== -1 && (t.id === 1 || t.id === 2 || t.id === 3));
  const groupBTabs = currentTabs.filter(t => !checkedOut[t.id] && t.groupId !== -1 && t.id === 4);
  if (groupATabs.length > 0 && groupBTabs.length > 0) {
    const maxIdxA = Math.max(...groupATabs.map(t => t.index));
    const minIdxB = Math.min(...groupBTabs.map(t => t.index));
    if (maxIdxA > minIdxB) {
      throw new Error(
        `[FAIL Step ${stepNum}: ${actionName}] グループ自体の並び順が逆転しています！\n` +
        `Group A (maxIdx: ${maxIdxA}) が Group B (minIdx: ${minIdxB}) の後ろに配置されています！\n` +
        `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
      );
    }
  }
}

async function runMonkeyTest(iterations = 300) {
  console.log(`=== ランダム耐久モンキーテスト (${iterations} 回の操作) 開始 ===`);
  mock._debug.reset(INITIAL_TABS, INITIAL_GROUPS);

  const tabIds = [1, 2, 3, 4, 5];

  for (let i = 1; i <= iterations; i++) {
    const op = Math.floor(Math.random() * 4);
    const tabs = mock._debug.getTabs();
    let actionLog = '';

    if (op === 0 || op === 1) {
      // ランダムな 2 タブで openSplitTabs
      const idx1 = Math.floor(Math.random() * tabIds.length);
      let idx2 = Math.floor(Math.random() * tabIds.length);
      while (idx2 === idx1) idx2 = Math.floor(Math.random() * tabIds.length);

      const tid1 = tabIds[idx1];
      const tid2 = tabIds[idx2];
      actionLog = `Step ${i}: openSplitTabs(${tid1}, ${tid2})`;
      await openSplitTabs(tid1, tid2);
      await assertInvariants(i, `openSplitTabs(${tid1}, ${tid2})`);
    } else if (op === 2) {
      // ランダムに分割中タブを解除
      const splitTabs = tabs.filter(t => t.splitViewId && t.splitViewId !== -1);
      if (splitTabs.length > 0) {
        const target = splitTabs[Math.floor(Math.random() * splitTabs.length)];
        actionLog = `Step ${i}: unsplitAndActivate(${target.id})`;
        await unsplitAndActivate(target.id, target.splitViewId, 1);
        await assertInvariants(i, `unsplitAndActivate(${target.id})`);
      } else {
        actionLog = `Step ${i}: unsplit (skip)`;
      }
    } else {
      // 調停処理の実行
      actionLog = `Step ${i}: reconcileCheckedOutTabs()`;
      await reconcileCheckedOutTabs(1);
      await assertInvariants(i, `reconcileCheckedOutTabs()`);
    }

    console.log(actionLog);

    if (i % 50 === 0) {
      console.log(`[PASS] ${i} 回のランダム操作を完了、不変条件はすべて維持されています`);
    }
  }

  // 最後に全タブの分割を解除して完全復帰をテスト
  console.log('--- 最終テスト: 全分割解除後の完全復元チェック ---');
  let splitTabs = mock._debug.getTabs().filter(t => t.splitViewId && t.splitViewId !== -1);
  for (const t of splitTabs) {
    if (t.splitViewId !== -1) {
      await unsplitAndActivate(t.id, t.splitViewId, 1);
    }
  }
  await reconcileCheckedOutTabs(1);
  await assertInvariants(iterations + 1, 'Final Cleanup');

  console.log('=== モンキーテスト完全合格！破壊されるケースは 0 件でした！ ===');
}

runMonkeyTest(300).catch(err => {
  console.error('\n' + err.message);
  process.exit(1);
});
