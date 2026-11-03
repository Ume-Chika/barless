// test/mock-chrome.js - Chrome API の精密なインメモリシミュレータ

export function createMockChrome() {
  let nextTabId = 1;
  let nextGroupId = 100;
  let nextSplitViewId = 1;

  let tabs = [];
  let tabGroups = [];
  const sessionStore = {};
  const syncStore = { smartGroupReturn: true };

  const reindex = () => { tabs.forEach((t, i) => { t.index = i; }); };
  const getGroup = (gid) => tabGroups.find(g => g.id === gid) || null;
  const cleanupEmptyGroups = () => {
    tabGroups = tabGroups.filter(g => tabs.some(t => t.groupId === g.id));
  };

  const mock = {
    tabs: {
      async get(tabId) {
        const t = tabs.find(x => x.id === tabId);
        if (!t) throw new Error(`Tab not found: ${tabId}`);
        return { ...t };
      },
      async query(queryInfo = {}) {
        let res = [...tabs];
        if (queryInfo.groupId !== undefined) res = res.filter(t => t.groupId === queryInfo.groupId);
        if (queryInfo.windowId !== undefined) res = res.filter(t => t.windowId === queryInfo.windowId);
        return res.map(t => ({ ...t }));
      },
      async create(props = {}) {
        const id = nextTabId++;
        const tab = {
          id, index: tabs.length, windowId: props.windowId || 1,
          groupId: -1, splitViewId: -1, url: props.url || 'about:blank',
          title: props.title || 'New Tab', active: Boolean(props.active)
        };
        tabs.push(tab);
        reindex();
        return { ...tab };
      },
      async move(tabIds, moveProperties) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        let targetIdx = moveProperties.index;
        if (targetIdx === -1 || targetIdx >= tabs.length) targetIdx = tabs.length - 1;

        for (const id of ids) {
          const curIdx = tabs.findIndex(t => t.id === id);
          if (curIdx === -1) continue;
          const [item] = tabs.splice(curIdx, 1);
          const destIdx = (moveProperties.index === -1) ? tabs.length : Math.min(tabs.length, targetIdx);
          tabs.splice(destIdx, 0, item);
          reindex();
        }
        return Array.isArray(tabIds) ? ids.map(id => mock.tabs.get(id)) : mock.tabs.get(ids[0]);
      },
      async group(options) {
        const ids = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
        let gid = options.groupId;
        const isExisting = Boolean(gid && getGroup(gid));
        if (!isExisting) {
          gid = nextGroupId++;
          tabGroups.push({ id: gid, title: 'Group ' + gid, color: 'blue', windowId: 1 });
        }

        if (isExisting) {
          const existingTabs = tabs.filter(t => t.groupId === gid && !ids.includes(t.id));
          if (existingTabs.length > 0) {
            let insertPos = Math.max(...existingTabs.map(t => t.index)) + 1;
            for (const id of ids) {
              const curIdx = tabs.findIndex(t => t.id === id);
              if (curIdx === -1) continue;
              const [item] = tabs.splice(curIdx, 1);
              if (curIdx < insertPos) insertPos--;
              tabs.splice(insertPos, 0, item);
              insertPos++;
              reindex();
            }
          }
        } else if (ids.length > 1) {
          let insertPos = tabs.findIndex(t => t.id === ids[0]) + 1;
          for (let i = 1; i < ids.length; i++) {
            const curIdx = tabs.findIndex(t => t.id === ids[i]);
            if (curIdx === -1) continue;
            const [item] = tabs.splice(curIdx, 1);
            if (curIdx < insertPos) insertPos--;
            tabs.splice(insertPos, 0, item);
            insertPos++;
            reindex();
          }
        }

        for (const id of ids) {
          const t = tabs.find(x => x.id === id);
          if (t) t.groupId = gid;
        }
        return gid;
      },
      async ungroup(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          const t = tabs.find(x => x.id === id);
          if (t) t.groupId = -1;
        }
        cleanupEmptyGroups();
      },
      async createSplit(tabIds) {
        if (!tabIds || tabIds.length !== 2) throw new Error('createSplit requires 2 tabs');
        const splitId = nextSplitViewId++;
        for (const id of tabIds) {
          const t = tabs.find(x => x.id === id);
          if (t) t.splitViewId = splitId;
        }
        return splitId;
      },
      async unsplit(splitViewId) {
        for (const t of tabs) {
          if (t.splitViewId === splitViewId) t.splitViewId = -1;
        }
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        tabs = tabs.filter(t => !ids.includes(t.id));
        cleanupEmptyGroups();
        reindex();
      },
      async update(tabId, props) {
        const t = tabs.find(x => x.id === tabId);
        if (t) Object.assign(t, props);
        return { ...t };
      }
    },
    tabGroups: {
      async get(groupId) {
        const g = getGroup(groupId);
        if (!g) throw new Error(`Group not found: ${groupId}`);
        return { ...g };
      },
      async query() { return tabGroups.map(g => ({ ...g })); },
      async update(groupId, props) {
        const g = getGroup(groupId);
        if (g) Object.assign(g, props);
        return { ...g };
      },
      async move(groupId, moveProperties) {
        const gTabs = tabs.filter(t => t.groupId === groupId);
        if (gTabs.length > 0) await mock.tabs.move(gTabs.map(t => t.id), moveProperties);
      }
    },
    windows: {
      async getLastFocused() { return { id: 1 }; },
      async getCurrent() { return { id: 1 }; },
      async update() {}
    },
    storage: {
      session: {
        async get(keys) {
          if (typeof keys === 'string') return { [keys]: sessionStore[keys] };
          return { ...sessionStore };
        },
        async set(items) { Object.assign(sessionStore, items); }
      },
      sync: {
        async get() { return { ...syncStore }; },
        async set(items) { Object.assign(syncStore, items); }
      }
    },
    _debug: {
      getTabs: () => tabs,
      getGroups: () => tabGroups,
      getSession: () => sessionStore,
      reset(newTabs, newGroups) {
        tabs = newTabs.map((t, i) => ({ ...t, index: i }));
        tabGroups = newGroups ? [...newGroups] : [];
        for (const k of Object.keys(sessionStore)) delete sessionStore[k];
      }
    }
  };

  return mock;
}
