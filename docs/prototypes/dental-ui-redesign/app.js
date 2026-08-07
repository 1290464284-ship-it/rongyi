const pages = {
  dashboard: { title: "工作台", crumb: "日常运营" },
  patients: { title: "患者管理", crumb: "日常运营" },
  schedule: { title: "预约排班", crumb: "日常运营" },
  clinical: { title: "临床工作台", crumb: "日常运营" },
  charges: { title: "收费管理", crumb: "财务管理" },
  components: { title: "组件库", crumb: "设计系统" },
};

let chart = null;
let currentPage = "dashboard";

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  renderPage(currentPage);
  lucide.createIcons();
});

document.querySelectorAll(".nav-item[data-page]").forEach((button) => {
  button.addEventListener("click", () => switchPage(button.dataset.page));
});

document.getElementById("sidebar-toggle").addEventListener("click", () => {
  document.getElementById("app-shell").classList.toggle("collapsed");
  lucide.createIcons();
});

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeModal);
});

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  renderPage(page);
  lucide.createIcons();
}

function renderPage(page) {
  const container = document.getElementById("page-container");
  const meta = pages[page];
  document.getElementById("page-title").textContent = meta.title;
  document.getElementById("page-crumb").textContent = meta.crumb;
  container.innerHTML = pageRenderers[page]();
  lucide.createIcons();
  if (page === "dashboard") renderChart();
}

const pageRenderers = {
  dashboard() {
    const { stats, schedule, categoryRevenue, alerts } = MOCK;
    return `
      ${renderStats(stats)}
      <div class="two-col">
        <div class="card">
          <div class="card-head">
            <div>
              <h4>近 7 日收费趋势</h4>
              <span class="sub">按日汇总 · 单位：元</span>
            </div>
            <button class="btn"><i data-lucide="download"></i>导出</button>
          </div>
          <div class="card-body"><div class="chart-box"><canvas id="revenue-chart"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h4>今日预约</h4>
              <span class="sub">接下来 4 小时</span>
            </div>
            <a class="mini-btn primary" href="#" onclick="event.preventDefault();switchPage('schedule')">查看排班</a>
          </div>
          <div class="table-wrap">
            <table>
              <tbody>
                ${schedule.slice(0, 5).map((item) => `
                  <tr>
                    <td><span class="tag">${item.time}</span></td>
                    <td><span class="table-cell-main">${item.name}</span><br/><span class="table-cell-sub">${item.doctor}</span></td>
                    <td>${item.type}</td>
                    <td><span class="status ${item.tone === "amber" ? "pending" : "arrived"}">${item.tone === "amber" ? "待就诊" : "已到诊"}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="three-col">
        <div class="card">
          <div class="card-head"><h4>收入结构</h4></div>
          <div class="card-body bar-list">
            ${categoryRevenue.map((item) => `
              <div class="bar-row">
                <span>${item.label}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${item.value}%"></div></div>
                <strong>${item.amount}</strong>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h4>待办提醒</h4></div>
          <div class="alert-list">
            ${alerts.map((alert) => `
              <div class="alert-item">
                <div class="alert-icon" style="background:var(--${alert.tone}-soft);color:var(--${alert.tone});">
                  <i data-lucide="${alert.tone === "rose" ? "triangle-alert" : alert.tone === "amber" ? "wrench" : "clock"}"></i>
                </div>
                <div>
                  <strong>${alert.title}</strong>
                  <span>${alert.detail}</span>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h4>快捷操作</h4></div>
          <div class="card-body" style="display:grid;gap:10px">
            <button class="btn" onclick="event.preventDefault();openModal('new-patient')"><i data-lucide="user-plus"></i>新建患者</button>
            <button class="btn" onclick="event.preventDefault();switchPage('schedule')"><i data-lucide="calendar-plus"></i>新建预约</button>
            <button class="btn" onclick="event.preventDefault();switchPage('charges')"><i data-lucide="receipt"></i>新建收费单</button>
            <button class="btn" onclick="event.preventDefault();switchPage('clinical')"><i data-lucide="stethoscope"></i>进入临床工作台</button>
          </div>
        </div>
      </div>
    `;
  },

  patients() {
    const rows = MOCK.patients.map((patient) => `
      <tr>
        <td><span class="tag">${patient.id}</span></td>
        <td>
          <span class="table-cell-main">${patient.name}</span><br/>
          <span class="table-cell-sub">${patient.gender} · ${patient.age} 岁</span>
        </td>
        <td>${patient.phone}</td>
        <td>${patient.source}</td>
        <td>${patient.visits} 次</td>
        <td><span class="status ${statusTone(patient.status)}">${patient.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="mini-btn primary">档案</button>
            <button class="mini-btn">编辑</button>
          </div>
        </td>
      </tr>
    `).join("");
    return `
      <div class="page-head">
        <div><h3>患者档案</h3><p>共 2,418 位患者 · 今日新增 6 位</p></div>
        <div class="page-actions">
          <button class="btn"><i data-lucide="download"></i>导出</button>
          <button class="btn btn-primary" onclick="event.preventDefault();openModal('new-patient')"><i data-lucide="user-plus"></i>新建患者</button>
        </div>
      </div>
      <div class="card">
        <div class="filter-bar">
          <div class="filter-input"><i data-lucide="search"></i><input placeholder="搜索姓名、编号或手机号..." /></div>
          <select class="filter-select"><option>全部来源</option><option>到店</option><option>转介</option><option>线上</option></select>
          <select class="filter-select"><option>全部状态</option><option>就诊中</option><option>已预约</option><option>已完成</option></select>
          <button class="btn"><i data-lucide="filter"></i>筛选</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>编号</th><th>患者</th><th>联系电话</th><th>来源</th><th>就诊次数</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pagination"><span>显示 1-8，共 2,418</span><button class="mini-btn">上一页</button><button class="mini-btn">下一页</button></div>
      </div>
    `;
  },

  schedule() {
    const blocks = MOCK.schedule.map((item) => `
      <div class="time-row" style="display:grid;grid-template-columns:64px 1fr;gap:8px">
        <div class="time-label">${item.time}</div>
        <div class="appt-block ${item.tone}">
          <strong>${item.name} · ${item.type}</strong>
          <span>${item.doctor} · ${item.time}</span>
        </div>
      </div>
    `).join("");
    return `
      <div class="page-head">
        <div><h3>预约与排班</h3><p>今日 2026-08-08 · 8 位医生在诊</p></div>
        <div class="page-actions">
          <button class="btn"><i data-lucide="chevron-left"></i></button>
          <button class="date-chip"><i data-lucide="calendar"></i>今天</button>
          <button class="btn"><i data-lucide="chevron-right"></i></button>
          <button class="btn btn-primary"><i data-lucide="calendar-plus"></i>新建预约</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="doctor-tabs">
            <button class="doctor-tab active">全部</button>
            <button class="doctor-tab">李医生</button>
            <button class="doctor-tab">王医生</button>
            <button class="doctor-tab">张医生</button>
          </div>
          <span class="sub">点击时间块查看患者详情</span>
        </div>
        <div class="card-body">${blocks}</div>
      </div>
    `;
  },

  clinical() {
    const { waiting, inProgress, done } = MOCK.queue;
    const col = (title, count, items, tone) => `
      <div class="queue-col">
        <div class="card">
          <div class="card-head">
            <h4>${title}</h4>
            <span class="queue-count">${count}</span>
          </div>
          ${items.map((item) => `
            <div class="patient-card">
              <div class="patient-card-head">
                <strong>${item.name}</strong>
                <span class="tag">${item.time ?? item.doctor}</span>
              </div>
              <p>${item.reason}</p>
              <div class="patient-card-actions">
                ${tone === "waiting" ? '<button class="mini-btn primary">接诊</button><button class="mini-btn">查看</button>' : tone === "in" ? '<button class="mini-btn primary">完成</button><button class="mini-btn">开单</button>' : '<button class="mini-btn">回访</button>'}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    return `
      <div class="page-head">
        <div><h3>临床工作台</h3><p>候诊队列实时更新 · 今日 38 个预约</p></div>
        <div class="page-actions">
          <button class="btn"><i data-lucide="bell-ring"></i>叫号</button>
          <button class="btn btn-primary"><i data-lucide="plus"></i>快速建档</button>
        </div>
      </div>
      <div class="queue-grid">
        ${col("候诊", waiting.length, waiting, "waiting")}
        ${col("就诊中", inProgress.length, inProgress, "in")}
        ${col("已完成", done.length, done, "done")}
      </div>
    `;
  },

  charges() {
    const rows = MOCK.charges.map((charge) => `
      <tr>
        <td><span class="tag">${charge.id}</span></td>
        <td><span class="table-cell-main">${charge.patient}</span><br/><span class="table-cell-sub">${charge.time}</span></td>
        <td>${charge.item}</td>
        <td class="amount">${charge.amount}</td>
        <td>${charge.method}</td>
        <td><span class="status ${charge.status === "已支付" ? "done" : charge.status === "待支付" ? "pending" : "cancelled"}">${charge.status}</span></td>
        <td><div class="row-actions"><button class="mini-btn primary">详情</button><button class="mini-btn">操作</button></div></td>
      </tr>
    `).join("");
    return `
      ${renderStats([
        { label: "今日收费", value: "¥28,640", trend: "+8.2%", icon: "wallet", tone: "teal" },
        { label: "待收金额", value: "¥6,420", trend: "4 张账单", icon: "clock", tone: "amber" },
        { label: "今日退款", value: "¥520", trend: "1 笔", icon: "rotate-ccw", tone: "rose" },
        { label: "会员储值", value: "¥86,300", trend: "+1.4%", icon: "credit-card", tone: "blue" },
      ])}
      <div class="card">
        <div class="filter-bar">
          <div class="filter-input"><i data-lucide="search"></i><input placeholder="搜索收费单号或患者..." /></div>
          <select class="filter-select"><option>全部状态</option><option>已支付</option><option>待支付</option><option>已退款</option></select>
          <button class="btn"><i data-lucide="filter"></i>筛选</button>
          <button class="btn btn-primary" style="margin-left:auto"><i data-lucide="plus"></i>新建收费单</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>收费单号</th><th>患者</th><th>项目</th><th>金额</th><th>支付方式</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pagination"><span>显示 1-6，共 86</span><button class="mini-btn">上一页</button><button class="mini-btn">下一页</button></div>
      </div>
    `;
  },

  components() {
    const upperTeeth = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
    const lowerTeeth = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
    return `
      <div class="page-head">
        <div><h3>核心与通用组件</h3><p>统一反馈、表单、导航与展示元素</p></div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="showToast('success','组件样式已应用')"><i data-lucide="sparkles"></i>应用组件</button>
        </div>
      </div>

      <section class="card component-card">
        <div class="card-head">
          <h4>反馈</h4>
          <span class="sub">Toast · 确认弹窗 · 抽屉</span>
        </div>
        <div class="card-body demo-row">
          <button class="btn btn-primary" onclick="showToast('success','已保存到本地')"><i data-lucide="circle-check"></i>成功提示</button>
          <button class="btn" onclick="showToast('error','网络连接失败')"><i data-lucide="circle-x"></i>错误提示</button>
          <button class="btn" onclick="showToast('warning','库存仅剩 2 件')"><i data-lucide="triangle-alert"></i>警告提示</button>
          <button class="btn btn-danger" onclick="openConfirm('删除患者档案','删除后不可恢复，确定继续吗？',function(){showToast('success','已删除')})"><i data-lucide="trash-2"></i>确认弹窗</button>
          <button class="btn" onclick="openDrawer('患者详情')"><i data-lucide="panel-right-open"></i>打开抽屉</button>
        </div>
      </section>

      <section class="card component-card">
        <div class="card-head">
          <h4>表单</h4>
          <span class="sub">日期 · 开关 · 单选 · 分段 · 多选</span>
        </div>
        <div class="card-body">
          <div class="demo-grid">
            <label class="field-item">
              <span>日期</span>
              <input type="date" class="date-field" value="2026-08-08" />
            </label>
            <label class="field-item">
              <span>日期范围</span>
              <span class="date-range"><input type="date" value="2026-08-01" /><i data-lucide="arrow-right"></i><input type="date" value="2026-08-08" /></span>
            </label>
            <div class="field-item">
              <span>开关</span>
              <div class="switch-row">
                <button class="switch on" role="switch" aria-checked="true" onclick="toggleSwitch(this)"><span></span></button>
                <button class="switch" role="switch" aria-checked="false" onclick="toggleSwitch(this)"><span></span></button>
              </div>
            </div>
            <div class="field-item">
              <span>单选</span>
              <div class="radio-row">
                <label class="radio"><input type="radio" name="demo-radio" checked /><span>到店</span></label>
                <label class="radio"><input type="radio" name="demo-radio" /><span>转介</span></label>
                <label class="radio"><input type="radio" name="demo-radio" /><span>线上</span></label>
              </div>
            </div>
            <div class="field-item">
              <span>分段控制</span>
              <div class="segmented">
                <button class="active" onclick="setSegmented(this)">今日</button>
                <button onclick="setSegmented(this)">本周</button>
                <button onclick="setSegmented(this)">本月</button>
              </div>
            </div>
            <div class="field-item">
              <span>禁用</span>
              <input disabled value="不可编辑" />
            </div>
            <div class="field-item">
              <span>校验错误</span>
              <input class="input-error" value="格式不正确" />
            </div>
            <div class="field-item field-wide">
              <span>可搜索多选</span>
              <div class="multi-select">
                <div class="multi-select-input">
                  <span class="chip">洁牙 <i data-lucide="x" onclick="removeChip(this)"></i></span>
                  <span class="chip">根管治疗 <i data-lucide="x" onclick="removeChip(this)"></i></span>
                  <input placeholder="搜索项目..." />
                  <button class="icon-btn mini-icon" onclick="toggleMultiSelect(this)"><i data-lucide="chevron-down"></i></button>
                </div>
                <div class="multi-select-menu hidden">
                  <label class="menu-check"><input type="checkbox" checked /><span>洁牙</span><span class="tag">¥380</span></label>
                  <label class="menu-check"><input type="checkbox" checked /><span>根管治疗</span><span class="tag">¥1,200</span></label>
                  <label class="menu-check"><input type="checkbox" /><span>种植牙</span><span class="tag">¥8,800</span></label>
                  <label class="menu-check"><input type="checkbox" /><span>正畸方案</span><span class="tag">¥18,000</span></label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="card component-card">
        <div class="card-head">
          <h4>加载与状态</h4>
          <span class="sub">骨架屏 · 空状态 · 错误状态</span>
        </div>
        <div class="card-body state-demo-grid">
          <div class="skeleton-block">
            <div class="skeleton-line w60"></div>
            <div class="skeleton-line w90"></div>
            <div class="skeleton-line w75"></div>
            <div class="skeleton-line w40"></div>
          </div>
          <div class="state-box">
            <i data-lucide="inbox"></i>
            <strong>暂无记录</strong>
            <button class="mini-btn" onclick="showToast('info','已打开新建表单')">新建</button>
          </div>
          <div class="state-box error">
            <i data-lucide="circle-alert"></i>
            <strong>加载失败</strong>
            <button class="mini-btn" onclick="showToast('info','已重新加载')">重试</button>
          </div>
        </div>
      </section>

      <section class="card component-card">
        <div class="card-head">
          <h4>导航与选择</h4>
          <span class="sub">下拉菜单 · Tooltip · 批量操作</span>
        </div>
        <div class="card-body">
          <div class="demo-row">
            <div class="dropdown">
              <button class="btn" onclick="toggleDropdown(this)"><i data-lucide="more-horizontal"></i>更多 <i data-lucide="chevron-down"></i></button>
              <div class="dropdown-menu hidden">
                <button onclick="showToast('info','已打开编辑')"><i data-lucide="pencil"></i>编辑</button>
                <button onclick="showToast('info','已复制')"><i data-lucide="copy"></i>复制</button>
                <button class="danger" onclick="openConfirm('删除记录','确定删除这条记录吗？',function(){showToast('success','已删除')})"><i data-lucide="trash-2"></i>删除</button>
              </div>
            </div>
            <div class="tooltip-wrap">
              <button class="btn"><i data-lucide="help-circle"></i>悬浮查看</button>
              <span class="tooltip">仅对当前患者可见</span>
            </div>
            <div class="batch-bar">
              <label class="check"><input type="checkbox" checked /><span>已选 3 项</span></label>
              <button class="mini-btn" onclick="showToast('info','已批量归档')">批量归档</button>
              <button class="mini-btn" onclick="showToast('info','已开始导出')">批量导出</button>
              <button class="mini-btn danger" onclick="openConfirm('批量删除','确定删除选中的 3 条记录吗？',function(){showToast('success','已删除')})">批量删除</button>
            </div>
          </div>
        </div>
      </section>

      <section class="card component-card">
        <div class="card-head">
          <h4>展示</h4>
          <span class="sub">折叠面板 · 时间线</span>
        </div>
        <div class="card-body component-split">
          <div class="accordion">
            <div class="accordion-item open">
              <button class="accordion-head" onclick="toggleAccordion(this)"><span>患者信息</span><i data-lucide="chevron-down"></i></button>
              <div class="accordion-body">张三 · 138****6688 · 青霉素过敏</div>
            </div>
            <div class="accordion-item">
              <button class="accordion-head" onclick="toggleAccordion(this)"><span>治疗记录</span><i data-lucide="chevron-down"></i></button>
              <div class="accordion-body">2026-08-02 洁牙 · 2026-08-08 根管治疗</div>
            </div>
            <div class="accordion-item">
              <button class="accordion-head" onclick="toggleAccordion(this)"><span>随访计划</span><i data-lucide="chevron-down"></i></button>
              <div class="accordion-body">下次复查 2026-09-08</div>
            </div>
          </div>
          <div class="timeline">
            <div class="timeline-item done">
              <div class="timeline-dot"></div>
              <div><strong>初诊登记</strong><span>2026-08-01 09:12</span></div>
            </div>
            <div class="timeline-item done">
              <div class="timeline-dot"></div>
              <div><strong>洁牙完成</strong><span>2026-08-02 10:30</span></div>
            </div>
            <div class="timeline-item current">
              <div class="timeline-dot"></div>
              <div><strong>根管治疗</strong><span>2026-08-08 14:00</span></div>
            </div>
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div><strong>复查随访</strong><span>2026-09-08</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="card component-card">
        <div class="card-head">
          <h4>领域</h4>
          <span class="sub">树 · 步骤 · 看板 · 上传 · 牙位图 · 报告</span>
        </div>
        <div class="card-body domain-grid">
          <div class="domain-panel">
            <h5>收费项目树</h5>
            <div class="tree">
              <div class="tree-node open">
                <div class="tree-item">
                  <button class="tree-toggle" onclick="toggleTree(this)"><i data-lucide="chevron-right"></i></button>
                  <span onclick="selectTreeItem(this)">基础治疗</span>
                  <span class="tag">12</span>
                </div>
                <div class="tree-children">
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">洁牙</span><span class="tag">¥380</span></div>
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">补牙</span><span class="tag">¥260</span></div>
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">根管治疗</span><span class="tag">¥1,200</span></div>
                </div>
              </div>
              <div class="tree-node">
                <div class="tree-item">
                  <button class="tree-toggle" onclick="toggleTree(this)"><i data-lucide="chevron-right"></i></button>
                  <span onclick="selectTreeItem(this)">修复治疗</span>
                  <span class="tag">6</span>
                </div>
                <div class="tree-children">
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">种植牙</span><span class="tag">¥8,800</span></div>
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">烤瓷牙</span><span class="tag">¥1,500</span></div>
                </div>
              </div>
              <div class="tree-node">
                <div class="tree-item">
                  <button class="tree-toggle" onclick="toggleTree(this)"><i data-lucide="chevron-right"></i></button>
                  <span onclick="selectTreeItem(this)">正畸治疗</span>
                  <span class="tag">4</span>
                </div>
                <div class="tree-children">
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">固定矫正</span><span class="tag">¥18,000</span></div>
                  <div class="tree-item"><span class="tree-dot"></span><span onclick="selectTreeItem(this)">隐形矫正</span><span class="tag">¥26,000</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="domain-panel">
            <h5>收费步骤</h5>
            <div class="steps" id="steps-demo">
              <button class="step done" onclick="setStep(this, 0)"><span class="step-dot">1</span><span>选择项目</span></button>
              <button class="step active" onclick="setStep(this, 1)"><span class="step-dot">2</span><span>确认方案</span></button>
              <button class="step" onclick="setStep(this, 2)"><span class="step-dot">3</span><span>支付费用</span></button>
              <button class="step" onclick="setStep(this, 3)"><span class="step-dot">4</span><span>完成</span></button>
            </div>
          </div>

          <div class="domain-panel kanban-panel">
            <h5>候诊看板</h5>
            <div class="kanban">
              <div class="kanban-col" ondrop="dropCard(event)" ondragover="allowDrop(event)" ondragleave="leaveCol(event)">
                <div class="kanban-col-head">候诊 <span class="kanban-count">3</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k1" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>张三</strong><span>洁牙</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k2" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>李四</strong><span>根管治疗</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k3" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>王五</strong><span>补牙</span></div>
              </div>
              <div class="kanban-col" ondrop="dropCard(event)" ondragover="allowDrop(event)" ondragleave="leaveCol(event)">
                <div class="kanban-col-head">就诊中 <span class="kanban-count">1</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k4" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>赵六</strong><span>种植牙</span></div>
              </div>
              <div class="kanban-col" ondrop="dropCard(event)" ondragover="allowDrop(event)" ondragleave="leaveCol(event)">
                <div class="kanban-col-head">已完成 <span class="kanban-count">2</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k5" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>钱七</strong><span>洁牙</span></div>
                <div class="kanban-card" draggable="true" data-card-id="k6" ondragstart="dragCard(event)" ondragend="endDrag(event)"><strong>孙八</strong><span>拔牙</span></div>
              </div>
            </div>
          </div>

          <div class="domain-panel">
            <h5>影像上传</h5>
            <input type="file" id="upload-input" class="hidden" multiple onchange="handleUpload(this)" />
            <div class="upload-actions">
              <button class="btn" onclick="document.getElementById('upload-input').click()"><i data-lucide="upload"></i>选择影像</button>
              <button class="btn" onclick="showToast('info','已开始上传')"><i data-lucide="cloud-upload"></i>上传</button>
            </div>
            <div id="upload-preview" class="upload-preview"></div>
          </div>

          <div class="domain-panel">
            <h5>牙位图</h5>
            <div class="dental-chart">
              <div class="tooth-grid upper">
                ${upperTeeth.map((n) => `<button class="tooth ${n === 16 ? "selected" : n === 26 ? "issue" : n === 11 ? "done" : ""}" onclick="toggleTooth(this)">${n}</button>`).join("")}
              </div>
              <div class="tooth-divider"></div>
              <div class="tooth-grid lower">
                ${lowerTeeth.map((n) => `<button class="tooth ${n === 46 ? "done" : ""}" onclick="toggleTooth(this)">${n}</button>`).join("")}
              </div>
            </div>
            <div class="dental-legend">
              <span><i class="legend-dot normal"></i>正常</span>
              <span><i class="legend-dot issue"></i>需处理</span>
              <span><i class="legend-dot done"></i>已治疗</span>
            </div>
          </div>

          <div class="domain-panel">
            <h5>报告预览</h5>
            <div class="report-actions">
              <button class="btn btn-primary" onclick="openReport()"><i data-lucide="file-text"></i>治疗方案报告</button>
            </div>
            <div class="report-thumb" onclick="openReport()">
              <i data-lucide="file-text"></i>
              <div><strong>根管治疗方案</strong><span>张三 · 2026-08-08</span></div>
            </div>
          </div>
        </div>
      </section>
    `;
  },
};

function renderStats(stats) {
  return `
    <div class="stat-grid">
      ${stats.map((stat) => `
        <div class="stat-card">
          <div class="stat-card-top">
            <div class="stat-icon ${stat.tone}"><i data-lucide="${stat.icon}"></i></div>
            <span class="stat-trend">${stat.trend}</span>
          </div>
          <strong>${stat.value}</strong>
          <div class="stat-label">${stat.label}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function statusTone(status) {
  if (status === "就诊中" || status === "已完成") return "done";
  if (status === "已预约") return "arrived";
  if (status === "已取消") return "cancelled";
  return "pending";
}

function renderChart() {
  const canvas = document.getElementById("revenue-chart");
  if (!canvas) return;
  if (chart) chart.destroy();
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: MOCK.revenue.labels,
      datasets: [{
        data: MOCK.revenue.values,
        backgroundColor: token("--primary", "#0D8282"),
        borderRadius: 6,
        maxBarThickness: 34,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: "easeOutQuart" },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: token("--border-soft", "#E7EDF3") }, ticks: { color: token("--muted", "#5E7580") } },
        x: { grid: { display: false }, ticks: { color: token("--muted", "#5E7580") } },
      },
    },
  });
}

function openModal(kind) {
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  if (kind === "new-patient") {
    title.textContent = "新建患者";
    body.innerHTML = `
      <label><span>姓名</span><input placeholder="请输入患者姓名" /></label>
      <label><span>手机号</span><input placeholder="11 位手机号" /></label>
      <label><span>性别</span><select><option>男</option><option>女</option></select></label>
      <label><span>出生日期</span><input type="date" /></label>
      <label class="field-full"><span>来源</span><select><option>到店</option><option>转介</option><option>线上</option></select></label>
      <label class="field-full"><span>备注</span><input placeholder="过敏史、既往史等" /></label>
      <div class="modal-actions">
        <button class="btn" data-close-modal>取消</button>
        <button class="btn btn-primary" onclick="closeModal()">保存患者</button>
      </div>
    `;
  }
  modal.classList.remove("hidden");
  lucide.createIcons();
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("modal-body").className = "modal-body";
}

/* ---------- 组件库交互 ---------- */
let confirmCallback = null;

function showToast(type, message) {
  const root = document.getElementById("toast-root");
  const icons = { success: "circle-check", error: "circle-x", warning: "triangle-alert", info: "info" };
  const item = document.createElement("div");
  item.className = `toast-item ${type}`;
  item.innerHTML = `<i data-lucide="${icons[type] || "info"}"></i><span>${message}</span>`;
  root.appendChild(item);
  lucide.createIcons();
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => {
    item.classList.remove("show");
    setTimeout(() => item.remove(), 220);
  }, 3200);
}

function openConfirm(title, message, callback) {
  confirmCallback = callback;
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = `
    <div class="confirm-body">
      <div class="confirm-icon"><i data-lucide="triangle-alert"></i></div>
      <p>${message}</p>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn btn-danger" onclick="confirmAction()">确认</button>
    </div>
  `;
  modal.classList.remove("hidden");
  lucide.createIcons();
}

function confirmAction() {
  const callback = confirmCallback;
  confirmCallback = null;
  closeModal();
  if (callback) callback();
}

let drawerOpen = false;

function openDrawer(title) {
  if (drawerOpen) return;
  drawerOpen = true;
  const layer = document.createElement("div");
  layer.className = "drawer-layer";
  layer.innerHTML = `
    <div class="drawer-mask" onclick="closeDrawer()"></div>
    <aside class="drawer-panel">
      <div class="drawer-head">
        <div>
          <span class="sub">患者档案</span>
          <h3>${title}</h3>
        </div>
        <button class="icon-btn" onclick="closeDrawer()" aria-label="关闭"><i data-lucide="x"></i></button>
      </div>
      <div class="drawer-body">
        <div class="drawer-summary">
          <div class="avatar">张</div>
          <div><strong>张三</strong><span>男 · 28 岁 · 138****6688</span></div>
          <span class="status arrived">在诊</span>
        </div>
        <div class="drawer-stats">
          <div><span>就诊次数</span><strong>6 次</strong></div>
          <div><span>账户余额</span><strong>¥1,280</strong></div>
          <div><span>会员等级</span><strong>银卡</strong></div>
          <div><span>下次复诊</span><strong>09-08</strong></div>
        </div>
        <section class="drawer-section">
          <h4>基本信息</h4>
          <div class="drawer-fields">
            <div><span>性别</span><strong>男</strong></div>
            <div><span>出生日期</span><strong>1998-06-12</strong></div>
            <div><span>来源</span><strong>转介</strong></div>
            <div><span>过敏史</span><strong>青霉素</strong></div>
            <div><span>紧急联系人</span><strong>李女士</strong></div>
            <div><span>联系电话</span><strong>139****2210</strong></div>
          </div>
        </section>
        <section class="drawer-section">
          <h4>最近预约</h4>
          <div class="drawer-list">
            <div class="drawer-list-item"><span class="tag">08-08</span><div><strong>根管治疗</strong><span>王医生 · 14:00</span></div><span class="status done">已完成</span></div>
            <div class="drawer-list-item"><span class="tag">07-20</span><div><strong>洁牙</strong><span>李医生 · 10:30</span></div><span class="status done">已完成</span></div>
            <div class="drawer-list-item"><span class="tag">09-08</span><div><strong>复诊检查</strong><span>王医生 · 14:00</span></div><span class="status pending">待就诊</span></div>
          </div>
        </section>
        <section class="drawer-section">
          <h4>最近一次消费</h4>
          <div class="bill-list">
            <div class="bill-row"><span><span class="tag">08-08</span> 根管治疗费 · 已支付</span><strong>¥1,200</strong></div>
          </div>
        </section>
        <div class="drawer-note">本次就诊：根管治疗，预计费用 ¥1,200，剩余 1 次复诊。请于复诊前 3 天提醒患者。</div>
      </div>
      <div class="drawer-foot">
        <button class="btn" onclick="closeDrawer()">取消</button>
        <button class="btn btn-primary" onclick="showToast('success','档案已保存');closeDrawer()">保存</button>
      </div>
    </aside>
  `;
  document.body.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add("open"));
  lucide.createIcons();
}

function closeDrawer() {
  const layer = document.querySelector(".drawer-layer");
  if (!layer) {
    drawerOpen = false;
    return;
  }
  layer.classList.remove("open");
  setTimeout(() => {
    layer.remove();
    drawerOpen = false;
  }, 220);
}

function toggleSwitch(btn) {
  btn.classList.toggle("on");
  btn.setAttribute("aria-checked", btn.classList.contains("on"));
}

function setSegmented(btn) {
  btn.parentElement.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
  btn.classList.add("active");
}

function toggleMultiSelect(btn) {
  const menu = btn.closest(".multi-select").querySelector(".multi-select-menu");
  menu.classList.toggle("hidden");
}

function removeChip(el) {
  el.closest(".chip").remove();
}

function toggleDropdown(btn) {
  const menu = btn.parentElement.querySelector(".dropdown-menu");
  menu.classList.toggle("hidden");
}

function toggleAccordion(btn) {
  btn.parentElement.classList.toggle("open");
}

/* ---------- 领域组件交互 ---------- */
function toggleTree(btn) {
  const node = btn.closest(".tree-node");
  node.classList.toggle("open");
}

function selectTreeItem(el) {
  document.querySelectorAll(".tree-item").forEach((item) => item.classList.remove("selected"));
  el.closest(".tree-item").classList.add("selected");
}

function setStep(btn, index) {
  const steps = btn.closest(".steps");
  steps.querySelectorAll(".step").forEach((step, i) => {
    step.classList.toggle("done", i < index);
    step.classList.toggle("active", i === index);
  });
}

function dragCard(event) {
  const card = event.target.closest(".kanban-card");
  event.dataTransfer.setData("text/plain", card.dataset.cardId);
  card.classList.add("dragging");
}

function allowDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
}

function leaveCol(event) {
  event.currentTarget.classList.remove("drag-over");
}

function dropCard(event) {
  event.preventDefault();
  const col = event.currentTarget;
  col.classList.remove("drag-over");
  const id = event.dataTransfer.getData("text/plain");
  const card = document.querySelector(`[data-card-id="${id}"]`);
  if (card) col.appendChild(card);
  document.querySelectorAll(".kanban-col").forEach((column) => {
    const count = column.querySelector(".kanban-count");
    if (count) count.textContent = column.querySelectorAll(".kanban-card").length;
  });
}

function endDrag() {
  document.querySelectorAll(".kanban-card").forEach((card) => card.classList.remove("dragging"));
  document.querySelectorAll(".kanban-col").forEach((col) => col.classList.remove("drag-over"));
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function handleUpload(input) {
  const preview = document.getElementById("upload-preview");
  Array.from(input.files || []).forEach((file) => {
    const item = document.createElement("div");
    item.className = "upload-item";
    const thumb = file.type.startsWith("image/")
      ? `<img src="${URL.createObjectURL(file)}" alt="" />`
      : `<i data-lucide="file"></i>`;
    item.innerHTML = `
      <div class="upload-thumb">${thumb}</div>
      <div class="upload-meta"><strong>${file.name}</strong><span>${formatFileSize(file.size)}</span></div>
      <div class="upload-progress"><span></span></div>
      <button class="icon-btn mini-icon" onclick="removeUpload(this)" aria-label="移除"><i data-lucide="x"></i></button>
    `;
    preview.appendChild(item);
    lucide.createIcons();
    requestAnimationFrame(() => item.classList.add("done"));
  });
  input.value = "";
}

function removeUpload(btn) {
  btn.closest(".upload-item").remove();
}

function toggleTooth(btn) {
  btn.classList.toggle("selected");
}

function openReport() {
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = "治疗方案报告";
  const body = document.getElementById("modal-body");
  body.className = "modal-body report-body";
  body.innerHTML = `
    <div class="report-card">
      <div class="report-head">
        <div><strong>蓉易口腔诊所</strong><span>治疗方案报告</span></div>
        <div class="report-no">No. RY-2026-0808-001</div>
      </div>
      <div class="report-meta">
        <div><span>患者</span><strong>张三</strong></div>
        <div><span>医生</span><strong>王医生</strong></div>
        <div><span>日期</span><strong>2026-08-08</strong></div>
        <div><span>状态</span><strong>待确认</strong></div>
      </div>
      <table class="report-table">
        <thead><tr><th>项目</th><th>说明</th><th>数量</th><th>金额</th></tr></thead>
        <tbody>
          <tr><td>根管治疗</td><td>右下第一磨牙</td><td>1</td><td>¥1,200</td></tr>
          <tr><td>复诊检查</td><td>术后 7 天</td><td>1</td><td>¥0</td></tr>
        </tbody>
      </table>
      <div class="report-total"><span>合计</span><strong>¥1,200</strong></div>
      <div class="report-foot">本方案需经患者确认后执行。</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">关闭</button>
      <button class="btn btn-primary" onclick="showToast('success','报告已生成');window.print()"><i data-lucide="printer"></i>打印</button>
    </div>
  `;
  modal.classList.remove("hidden");
  lucide.createIcons();
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".dropdown-menu:not(.hidden)").forEach((menu) => {
    if (!menu.closest(".dropdown").contains(event.target)) menu.classList.add("hidden");
  });
  document.querySelectorAll(".multi-select-menu:not(.hidden)").forEach((menu) => {
    if (!menu.closest(".multi-select").contains(event.target)) menu.classList.add("hidden");
  });
});

// Init on load so icons render before login.
lucide.createIcons();
