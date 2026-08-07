/* 蓉易口腔诊所 · UI 原型 —— 通用行为
   页面无需定制 JS 即可获得：弹窗、危险操作确认、Toast、Tab 切换 */

/* ===== 弹窗：data-open-modal="#id" 打开；data-close-modal 关闭；点遮罩关闭 =====
   关闭走 .closing（120ms 对称淡出）后移除 .open，与打开动画对称 */
function resolveModal(sel) {
  if (!sel) return null;
  return sel[0] === '#' ? document.querySelector(sel) : document.getElementById(sel);
}
function openModal(sel) {
  const m = resolveModal(sel);
  if (!m) return;
  clearTimeout(m._closeTimer);
  m.classList.remove('closing');
  m.classList.add('open');
}
function closeModal(sel) {
  const m = resolveModal(sel);
  if (!m || !m.classList.contains('open')) return;
  m.classList.add('closing');
  clearTimeout(m._closeTimer);
  m._closeTimer = setTimeout(() => m.classList.remove('open', 'closing'), 160);
}

/* ===== 危险操作确认弹窗（统一入口） ===== */
function showConfirm(title, text, onOk) {
  let mask = document.getElementById('modal-confirm');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'modal-confirm';
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" style="width:420px">' +
        '<div class="modal-head"><h3>' + title + '</h3></div>' +
        '<div class="modal-body"><p style="font-size:13px;color:var(--muted)">' + text + '</p></div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-secondary" data-close-modal="modal-confirm">取消</button>' +
          '<button class="btn btn-danger" id="confirm-ok">确认</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);
    mask.querySelector('#confirm-ok').addEventListener('click', () => {
      closeModal('modal-confirm');
      onOk();
    });
  }
  mask.classList.add('open');
}

/* ===== Toast ===== */
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* ===== 事件委托：弹窗开关 / 确认 / Tab 切换 ===== */
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open-modal]');
  if (opener) { openModal(opener.dataset.openModal); return; }

  const closer = e.target.closest('[data-close-modal]');
  if (closer) {
    closeModal(closer.dataset.closeModal || closer.closest('.modal-mask')?.id);
    return;
  }

  if (e.target.classList.contains('modal-mask')) closeModal(e.target.id);

  const confirmBtn = e.target.closest('[data-confirm]');
  if (confirmBtn) {
    const msg = confirmBtn.dataset.confirm || '确定执行该操作吗？';
    showConfirm('操作确认', msg, () => showToast('已执行（原型演示）'));
    return;
  }

  const tab = e.target.closest('.tab[data-tab]');
  if (tab) {
    const group = tab.dataset.tabGroup || (tab.closest('.tabs') && tab.closest('.tabs').dataset.tabGroup);
    document.querySelectorAll('.tabs[data-tab-group="' + group + '"] .tab')
      .forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('[data-panel-group="' + group + '"]')
      .forEach(p => { p.style.display = (p.dataset.panel === tab.dataset.tab) ? '' : 'none'; });
  }
});

/* ===== 导航高亮：body[data-page] 匹配 a.nav-item[data-nav]；子页映射到父级菜单 ===== */
const NAV_ALIAS = { schedule: 'patients', imaging: 'treatment-plan' };
document.addEventListener('DOMContentLoaded', () => {
  const p = document.body.dataset.page;
  if (p) {
    const key = NAV_ALIAS[p] || p;
    document.querySelectorAll('a.nav-item[data-nav="' + key + '"]')
      .forEach(a => a.classList.add('active'));
  }
});
