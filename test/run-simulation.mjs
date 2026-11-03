// test/run-simulation.mjs - 自動モンキーテストスクリプト

import { createMockChrome } from './mock-chrome.js';

// グローバルに chrome をモック
const mock = createMockChrome();
globalThis.chrome = mock;

// background-split.js を動的インポート
const splitModule = await import('../js/background-split.js');
const { openSplitTabs, unsplitAndActivate, reconcileCheckedOutTabs, getCheckedOutTabs } = splitModule;

// テスト用のシナリオ設定
async function setupInitialScenario() {
  const tabs = [
    { id: 1, title: 'Tab A', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://a.com' },
    { id: 2, title: 'Tab B', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://b.com' },
    { id: 3, title: 'Tab C', groupId: 10, windowId: 1, splitViewId: -1, url: 'https://c.com' },
    { id: 4, title: 'Tab D', groupId: 20, windowId: 1, splitViewId: -1, url: 'https://d.com' },
    { id: 5, title: 'Tab E', groupId: -1, windowId: 1, splitViewId: -1, url: 'https://e.com' }
  ];
  const groups = [
    { id: 10, title: 'Group A', color: 'blue', windowId: 1 },
    { id: 20, title: 'Group B', color: 'red', windowId: 1 }
  ];
  mock._debug.reset(tabs, groups);
}

// 不変条件の検証
async function assertInvariants(stepName) {
  const currentTabs = mock._debug.getTabs();
  const currentGroups = mock._debug.getGroups();
  const checkedOut = await getCheckedOutTabs();

  // 1. 各グループの連続性（グループ内のタブの間に別グループのタブが挟まっていないか）
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
          `[FAIL: ${stepName}] グループ ${gid} が分断されています！ indices: ${indices.join(', ')}\n` +
          `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
        );
      }
    }
  }

  // 2. 所属なしタブが勝手にグループに入っていないか
  const tabE = currentTabs.find(t => t.id === 5);
  if (tabE && !checkedOut[5] && tabE.groupId !== -1) {
    throw new Error(
      `[FAIL: ${stepName}] 所属なしタブ E が勝手にグループ ${tabE.groupId} に編入されています！\n` +
      `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
    );
  }

  // 3. 元グループAのタブ（1, 2, 3）が別グループ（20）に混入していないか
  for (const tid of [1, 2, 3]) {
    const t = currentTabs.find(x => x.id === tid);
    if (t && t.groupId === 20) {
      throw new Error(
        `[FAIL: ${stepName}] 元グループAのタブ ${tid} がグループB（20）に混入しています！\n` +
        `現在のタブ一覧:\n` + JSON.stringify(currentTabs, null, 2)
      );
    }
  }
}

async function runTest() {
  console.log('--- ユーザー遭遇シナリオの再現テスト開始 ---');
  await setupInitialScenario();

  console.log('1. A と B を split');
  await openSplitTabs(1, 2);
  await assertInvariants('1. A+B split');

  console.log('2. C と E を split');
  await openSplitTabs(3, 5);
  await assertInvariants('2. C+E split');

  console.log('3. 左右入れ替えや調停などのガチャガチャ操作を実行');
  await openSplitTabs(2, 1); // A と B を入れ替え
  await assertInvariants('3. A+B 入れ替え');

  await openSplitTabs(5, 3); // C と E を入れ替え
  await assertInvariants('4. C+E 入れ替え');

  console.log('5. A と B を分割解除');
  const curTabs = mock._debug.getTabs();
  const tab1 = curTabs.find(t => t.id === 1);
  if (tab1 && tab1.splitViewId !== -1) {
    await unsplitAndActivate(1, tab1.splitViewId, 1);
  }
  await assertInvariants('5. A+B 分割解除');

  console.log('6. C と E を分割解除');
  const tab3 = curTabs.find(t => t.id === 3);
  if (tab3 && tab3.splitViewId !== -1) {
    await unsplitAndActivate(3, tab3.splitViewId, 1);
  }
  await assertInvariants('6. C+E 分割解除');

  console.log('--- シナリオテスト完全合格！ ---');
}

runTest().catch(err => {
  console.error('\n' + err.message);
  process.exit(1);
});
