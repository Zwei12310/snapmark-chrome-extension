// SnapMark - Popup Script
const btnScreenshot = document.getElementById('btnScreenshot');
const historyList = document.getElementById('historyList');
const statusMsg = document.getElementById('statusMsg');

let currentTab = null;

// 初始化
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTab = tabs[0];
  loadHistory();
});

// 截图按钮
btnScreenshot.addEventListener('click', async () => {
  btnScreenshot.disabled = true;
  btnScreenshot.textContent = '截图中...';

  chrome.runtime.sendMessage({ action: 'capture' }, (response) => {
    if (!response || response.error) {
      showStatus('截图失败: ' + (response?.error || '未知错误'), true);
      btnScreenshot.disabled = false;
      btnScreenshot.textContent = '截图当前页面';
      return;
    }

    // 保存历史 + 打开编辑器，全部交给 background 处理
    chrome.runtime.sendMessage({
      action: 'openEditorAfterCapture',
      dataUrl: response.dataUrl,
      url: currentTab.url,
      title: currentTab.title
    });

    window.close();
  });
});

// 加载历史
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const history = response.history || [];
    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty-state">暂无截图记录</div>';
      return;
    }

    historyList.innerHTML = history.map(item => `
      <div class="history-item">
        <img class="history-thumb" src="${item.dataUrl}" alt="">
        <div class="history-info">
          <div class="history-title">${escapeHtml(item.title || '未命名')}</div>
          <div class="history-time">${formatTime(item.timestamp)}</div>
        </div>
        <span class="history-del" data-id="${item.id}">×</span>
      </div>
    `).join('');

    // 点击缩略图打开编辑（通过 background 中转，处理无 content script 的情况）
    historyList.querySelectorAll('.history-thumb').forEach(img => {
      img.addEventListener('click', () => {
        const dataUrl = img.src;
        chrome.runtime.sendMessage({
          action: 'openEditorAfterCapture',
          dataUrl,
          url: currentTab.url,
          title: currentTab.title
        });
        window.close();
      });
    });

    // 删除按钮
    historyList.querySelectorAll('.history-del').forEach(del => {
      del.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        chrome.runtime.sendMessage({ action: 'deleteHistory', id }, () => loadHistory());
      });
    });
  });
}

function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? '#ff4757' : '#4caf50';
  setTimeout(() => { statusMsg.textContent = ''; }, 3000);
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
