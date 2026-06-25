// SnapMark - Content Script (标注编辑器)
// 在页面上叠加截图编辑器，支持矩形、箭头、文字标注

let editorOverlay = null;
let canvas = null;
let ctx = null;
let img = null;

// 标注工具状态
let tool = 'rect'; // rect | arrow | text
let color = '#FF4757'; // 红
let lineWidth = 3;
let drawing = false;
let startX = 0, startY = 0;
let annotations = []; // 已完成标注列表
let currentAnnotation = null; // 正在绘制的标注
let undoStack = [];

// 配色方案
const colors = ['#FF4757', '#FFA502', '#2ED573', '#1E90FF', '#A855F7', '#FFFFFF'];
const tools = [
  { id: 'rect', label: '框选', icon: '□' },
  { id: 'arrow', label: '箭头', icon: '→' },
  { id: 'text', label: '文字', icon: 'T' }
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openEditor') {
    createEditor(request.dataUrl);
    sendResponse({ success: true });
  }
});

function createEditor(dataUrl) {
  // 移除已有编辑器
  if (editorOverlay) editorOverlay.remove();

  // 创建叠加层
  editorOverlay = document.createElement('div');
  editorOverlay.id = 'snapmark-editor-overlay';
  editorOverlay.innerHTML = `
    <div id="snapmark-toolbar">
      <div class="sm-tools">
        ${tools.map(t => `
          <button class="sm-tool-btn ${tool === t.id ? 'active' : ''}" data-tool="${t.id}" title="${t.label}">
            ${t.icon} ${t.label}
          </button>
        `).join('')}
      </div>
      <div class="sm-colors">
        ${colors.map(c => `
          <span class="sm-color-dot ${color === c ? 'active' : ''}" data-color="${c}" style="background:${c}"></span>
        `).join('')}
      </div>
      <div class="sm-actions">
        <button id="sm-undo" class="sm-act-btn" title="撤销">↩</button>
        <button id="sm-download" class="sm-act-btn sm-primary">下载 PNG</button>
        <button id="sm-copy" class="sm-act-btn">复制</button>
        <button id="sm-close" class="sm-act-btn sm-danger">关闭</button>
      </div>
    </div>
    <div id="snapmark-canvas-container">
      <canvas id="snapmark-canvas"></canvas>
    </div>
  `;

  document.body.appendChild(editorOverlay);

  // 初始化 Canvas
  canvas = document.getElementById('snapmark-canvas');
  ctx = canvas.getContext('2d');
  img = new Image();

  img.onload = () => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    bindEvents();
  };
  img.src = dataUrl;

  // 工具栏事件
  editorOverlay.querySelectorAll('.sm-tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      tool = e.target.closest('.sm-tool-btn').dataset.tool;
      updateToolbarUI();
    });
  });

  editorOverlay.querySelectorAll('.sm-color-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      color = e.target.dataset.color;
      updateToolbarUI();
    });
  });

  document.getElementById('sm-undo').addEventListener('click', undo);
  document.getElementById('sm-download').addEventListener('click', downloadImage);
  document.getElementById('sm-copy').addEventListener('click', copyToClipboard);
  document.getElementById('sm-close').addEventListener('click', closeEditor);

  // 键盘快捷键
  document.addEventListener('keydown', handleKeyboard);
}

function resizeCanvas() {
  const container = document.getElementById('snapmark-canvas-container');
  const maxW = container.clientWidth;
  const maxH = container.clientHeight - 60;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);

  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';

  // 居中
  canvas.style.marginLeft = ((maxW - canvas.width) / 2) + 'px';
  canvas.style.marginTop = Math.max(0, (maxH - canvas.height) / 2) + 'px';

  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // 绘制已完成标注
  annotations.forEach(ann => drawAnnotation(ctx, ann));

  // 绘制当前标注
  if (currentAnnotation) {
    drawAnnotation(ctx, currentAnnotation);
  }
}

function drawAnnotation(ctx, ann) {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.lineWidth || lineWidth;
  ctx.font = 'bold 18px sans-serif';

  if (ann.type === 'rect') {
    // 半透明填充
    ctx.fillStyle = ann.color + '20';
    ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
    ctx.strokeStyle = ann.color;
    ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
  } else if (ann.type === 'arrow') {
    drawArrow(ctx, ann.x, ann.y, ann.ex, ann.ey, ann.color, ann.lineWidth);
  } else if (ann.type === 'text') {
    ctx.font = `bold ${ann.fontSize || 20}px sans-serif`;
    ctx.fillText(ann.text, ann.x, ann.y);
    // 文字背景高亮
    const metrics = ctx.measureText(ann.text);
    const tw = metrics.width;
    const th = ann.fontSize || 20;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ann.x - 4, ann.y - th + 4, tw + 8, th + 4);
    ctx.fillStyle = ann.color;
    ctx.fillText(ann.text, ann.x, ann.y);
  }

  ctx.restore();
}

function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
  const headLen = 14;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // 箭杆
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();

  // 箭头
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - Math.PI / 6),
    toY - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLen * Math.cos(angle + Math.PI / 6),
    toY - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function bindEvents() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.style.cursor = 'crosshair';
}

function unbindEvents() {
  canvas.removeEventListener('mousedown', onMouseDown);
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mouseup', onMouseUp);
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function onMouseDown(e) {
  const pos = getCanvasPos(e);
  drawing = true;
  startX = pos.x;
  startY = pos.y;

  if (tool === 'text') {
    const text = prompt('输入标注文字:', '');
    if (text && text.trim()) {
      annotations.push({
        type: 'text',
        text: text.trim(),
        x: pos.x,
        y: pos.y,
        color,
        fontSize: 20
      });
      undoStack = [];
      redraw();
    }
    drawing = false;
  }
}

function onMouseMove(e) {
  if (!drawing || tool === 'text') return;
  const pos = getCanvasPos(e);

  if (tool === 'rect') {
    currentAnnotation = {
      type: 'rect',
      x: Math.min(startX, pos.x),
      y: Math.min(startY, pos.y),
      w: Math.abs(pos.x - startX),
      h: Math.abs(pos.y - startY),
      color,
      lineWidth
    };
  } else if (tool === 'arrow') {
    currentAnnotation = {
      type: 'arrow',
      x: startX,
      y: startY,
      ex: pos.x,
      ey: pos.y,
      color,
      lineWidth
    };
  }
  redraw();
}

function onMouseUp(e) {
  if (!drawing || tool === 'text') return;
  drawing = false;

  if (currentAnnotation) {
    annotations.push({ ...currentAnnotation });
    undoStack = [];
  }
  currentAnnotation = null;
  redraw();
}

function undo() {
  if (annotations.length > 0) {
    undoStack.push(annotations.pop());
    redraw();
  }
}

function updateToolbarUI() {
  // 工具按钮
  editorOverlay.querySelectorAll('.sm-tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  // 颜色
  editorOverlay.querySelectorAll('.sm-color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === color);
  });
}

function getFinalImage() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  const tempCtx = tempCanvas.getContext('2d');

  // 先将原图画到临时 canvas
  tempCtx.drawImage(img, 0, 0);

  // 计算缩放比例并绘制标注
  const scaleX = img.width / canvas.width;
  const scaleY = img.height / canvas.height;

  annotations.forEach(ann => {
    const scaledAnn = { ...ann };

    if (ann.type === 'rect') {
      scaledAnn.x *= scaleX;
      scaledAnn.y *= scaleY;
      scaledAnn.w *= scaleX;
      scaledAnn.h *= scaleY;
    } else if (ann.type === 'arrow') {
      scaledAnn.x *= scaleX;
      scaledAnn.y *= scaleY;
      scaledAnn.ex *= scaleX;
      scaledAnn.ey *= scaleY;
    } else if (ann.type === 'text') {
      scaledAnn.x *= scaleX;
      scaledAnn.y *= scaleY;
      scaledAnn.fontSize = (ann.fontSize || 20) * scaleY;
    }

    drawAnnotation(tempCtx, scaledAnn);
  });

  return tempCanvas.toDataURL('image/png');
}

function downloadImage() {
  const dataUrl = getFinalImage();
  const filename = `snapmark-${window.location.hostname}-${Date.now()}.png`;

  // 通过 background 下载
  chrome.runtime.sendMessage({
    action: 'download',
    dataUrl,
    filename
  }, (response) => {
    if (response && response.error) {
      // 降级：直接链接下载
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    }
  });
}

async function copyToClipboard() {
  const dataUrl = getFinalImage();
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    showToast('已复制到剪贴板');
  } catch (err) {
    showToast('复制失败，请尝试下载');
  }
}

function closeEditor() {
  window.removeEventListener('resize', resizeCanvas);
  document.removeEventListener('keydown', handleKeyboard);
  unbindEvents();
  editorOverlay.remove();
  editorOverlay = null;
}

function handleKeyboard(e) {
  if (!editorOverlay) return;
  if (e.key === 'Escape') {
    closeEditor();
  } else if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    downloadImage();
  } else if (e.ctrlKey && e.key === 'c') {
    // 让默认复制行为处理，不拦截
  }
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: #1a1a2e; color: #fff; padding: 10px 24px; border-radius: 8px;
    z-index: 999999; font-size: 14px; font-family: sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    animation: smFadeIn 0.2s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// 注入动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes smFadeIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`;
document.head.appendChild(style);
