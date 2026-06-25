// SnapMark - Background Service Worker
// 处理截图请求、存储管理、分享链接生成

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    // sender.tab 在 popup 中为 undefined，通过 query 获取当前窗口
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const windowId = tabs[0]?.windowId;
      if (!windowId) {
        sendResponse({ error: '无法获取当前窗口' });
        return;
      }
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ dataUrl });
      });
    });
    return true;
  }

  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.dataUrl,
      filename: request.filename || `snapmark-${Date.now()}.png`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ downloadId });
    });
    return true;
  }

  if (request.action === 'saveHistory') {
    chrome.storage.local.get({ history: [] }, (result) => {
      const history = result.history;
      history.unshift({
        id: Date.now(),
        dataUrl: request.dataUrl,
        url: request.url,
        title: request.title,
        timestamp: new Date().toISOString()
      });
      // 最多保留 50 条
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ history }, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (request.action === 'getHistory') {
    chrome.storage.local.get({ history: [] }, (result) => {
      sendResponse({ history: result.history });
    });
    return true;
  }

  if (request.action === 'deleteHistory') {
    chrome.storage.local.get({ history: [] }, (result) => {
      const history = result.history.filter(item => item.id !== request.id);
      chrome.storage.local.set({ history }, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (request.action === 'openEditorAfterCapture') {
    // 1. 保存历史
    chrome.storage.local.get({ history: [] }, (result) => {
      const history = result.history;
      history.unshift({
        id: Date.now(),
        dataUrl: request.dataUrl,
        url: request.url,
        title: request.title,
        timestamp: new Date().toISOString()
      });
      if (history.length > 50) history.length = 50;
      chrome.storage.local.set({ history });
    });

    // 2. 获取当前 tab 并注入编辑器
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';

      // 受保护页面（chrome://、edge://、Chrome Web Store 等）无法注入脚本
      const isProtected = /^(chrome|edge|about|chrome-extension|devtools):\/\//i.test(tabUrl)
        || tabUrl.includes('chromewebstore.google.com')
        || tabUrl.includes('chrome.google.com/webstore');

      if (isProtected) {
        // 改为在新标签页中打开编辑器（用 data URL 渲染）
        chrome.tabs.create({
          url: request.dataUrl,
          active: true
        });
        return;
      }

      sendEditorMessage(tabId, request.dataUrl, 0);
    });
  }
});

/**
 * 向 content script 发送 openEditor 消息，失败时自动注入脚本后重试
 * @param {number} tabId
 * @param {string} dataUrl
 * @param {number} retryCount - 当前重试次数，最多 1 次
 */
function sendEditorMessage(tabId, dataUrl, retryCount) {
  chrome.tabs.sendMessage(tabId, {
    action: 'openEditor',
    dataUrl
  }, (response) => {
    if (chrome.runtime.lastError) {
      if (retryCount >= 1) {
        // 注入重试后仍失败，降级为新标签页打开
        console.warn('SnapMark: 无法注入编辑器，降级打开截图:', chrome.runtime.lastError.message);
        chrome.tabs.create({ url: dataUrl, active: true });
        return;
      }

      // 动态注入 content script
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js']
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('SnapMark: 脚本注入失败:', chrome.runtime.lastError.message);
          chrome.tabs.create({ url: dataUrl, active: true });
          return;
        }
        chrome.scripting.insertCSS({
          target: { tabId },
          files: ['src/content.css']
        }, () => {
          // CSS 注入失败不阻断，继续发消息
          sendEditorMessage(tabId, dataUrl, retryCount + 1);
        });
      });
    }
  });
}
