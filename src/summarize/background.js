(() => {
  const MENU_ID = 'a2gent-summarize-selection';
  const MESSAGE_TYPE = 'A2GENT_SUMMARIZE_SELECTION';

  const createMenu = () => chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Summarize with A2gent',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });

  const onClicked = (info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id) return;
    // The page has no listener on restricted or not yet injected tabs; there is nobody to show an error to.
    Promise.resolve(chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPE, text: info.selectionText || '' })).catch(() => {});
  };

  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.contextMenus.onClicked.addListener(onClicked);
})();
