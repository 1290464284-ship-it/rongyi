// 蓉易口腔诊所 · UI 原型 —— 全站假数据（中文、医疗真实感）
const DATA = {
  doctors: [
    { id: 1, name: '王建国', title: '主任医师', dept: '种植科' },
    { id: 2, name: '刘敏',   title: '主治医师', dept: '正畸科' },
    { id: 3, name: '陈晓东', title: '主治医师', dept: '修复科' },
  ],
  patients: [
    { id: 'P001', name: '张丽华', gender: '女', age: 38, phone: '138****6688', lastVisit: '2026-08-02', total: 3200,  source: '到店',   status: '治疗中' },
    { id: 'P002', name: '李志强', gender: '男', age: 45, phone: '139****2201', lastVisit: '2026-07-28', total: 8600,  source: '转介绍', status: '已完成' },
    { id: 'P003', name: '王秀英', gender: '女', age: 62, phone: '137****9934', lastVisit: '2026-08-05', total: 15800, source: '老客户', status: '治疗中' },
    { id: 'P004', name: '赵明',   gender: '男', age: 29, phone: '136****4510', lastVisit: '2026-08-01', total: 480,   source: '线上',   status: '待就诊' },
    { id: 'P005', name: '孙晓梅', gender: '女', age: 33, phone: '135****7788', lastVisit: '2026-07-30', total: 2100,  source: '到店',   status: '已完成' },
    { id: 'P006', name: '周建军', gender: '男', age: 51, phone: '133****5522', lastVisit: '2026-08-04', total: 6400,  source: '转介绍', status: '治疗中' },
  ],
  appointments: [
    { time: '09:00', name: '张丽华', item: '洁牙',         doctor: '王建国', dur: 40, status: 'done' },
    { time: '09:30', name: '赵明',   item: '初诊检查',     doctor: '刘敏',   dur: 30, status: 'done' },
    { time: '10:00', name: '李志强', item: '根管治疗',     doctor: '王建国', dur: 60, status: 'active' },
    { time: '10:30', name: '孙晓梅', item: '正畸复诊',     doctor: '刘敏',   dur: 40, status: 'info' },
    { time: '11:00', name: '王秀英', item: '种植二期',     doctor: '陈晓东', dur: 60, status: 'info' },
    { time: '14:00', name: '周建军', item: '牙周刮治',     doctor: '王建国', dur: 50, status: 'info' },
    { time: '15:00', name: '刘佳',   item: '补牙（树脂）', doctor: '陈晓东', dur: 40, status: 'info' },
    { time: '16:00', name: '吴敏',   item: '复查',         doctor: '刘敏',   dur: 20, status: 'info' },
  ],
  billing: [
    { name: '李志强', items: '根管治疗（完成）', amount: 1200, date: '2026-08-06', status: 'wait' },
    { name: '周建军', items: '牙周刮治（2 次）', amount: 2400, date: '2026-08-06', status: 'wait' },
    { name: '赵明',   items: '初诊检查费',       amount: 50,   date: '2026-08-06', status: 'wait' },
    { name: '孙晓梅', items: '正畸复诊调整',     amount: 300,  date: '2026-08-06', status: 'paid' },
  ],
  planRows: [
    { tooth: '26', item: '嵌体修复（全瓷）', material: 'E-max', price: 2600, qty: 1, status: 'done' },
    { tooth: '27', item: '根管治疗',         material: '—',     price: 1200, qty: 1, status: 'done' },
    { tooth: '27', item: '牙冠修复（全瓷）', material: 'E-max', price: 3200, qty: 1, status: 'todo' },
    { tooth: '36', item: '嵌体修复（全瓷）', material: 'E-max', price: 2600, qty: 1, status: 'todo' },
    { tooth: '—',  item: '洁牙（全口）',     material: '—',     price: 320,  qty: 1, status: 'todo' },
  ],
  images: [
    { group: '全景片', files: [
      { id: 'X1', name: '全景片 2026-08-02', date: '2026-08-02', note: '全口情况良好，26 嵌体在位' },
      { id: 'X2', name: '全景片 2025-11-10', date: '2025-11-10', note: '对比用历史片' },
    ]},
    { group: '根尖片', files: [
      { id: 'X3', name: '26 根尖片', date: '2026-08-02', note: '根充完善，根尖周无异常' },
      { id: 'X4', name: '36 根尖片', date: '2026-08-02', note: '牙周膜间隙增宽' },
    ]},
    { group: '侧位片', files: [
      { id: 'X5', name: '头颅侧位片', date: '2026-07-20', note: '正畸术前评估' },
    ]},
  ],
};
