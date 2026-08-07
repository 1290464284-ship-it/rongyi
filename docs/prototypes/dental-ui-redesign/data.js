window.MOCK = {
  stats: [
    { label: "今日预约", value: "38", trend: "+12.6%", icon: "calendar-days", tone: "teal" },
    { label: "待诊患者", value: "12", trend: "6 位即将到诊", icon: "users", tone: "blue" },
    { label: "今日收费", value: "¥28,640", trend: "+8.2%", icon: "wallet", tone: "amber" },
    { label: "库存预警", value: "5", trend: "2 项已断货", icon: "package-open", tone: "rose" },
  ],
  revenue: {
    labels: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    values: [12800, 15400, 14200, 18600, 17200, 24100, 19800],
  },
  categoryRevenue: [
    { label: "口腔修复", value: 38, amount: "¥32,400" },
    { label: "正畸治疗", value: 24, amount: "¥20,600" },
    { label: "洁牙护理", value: 19, amount: "¥16,100" },
    { label: "种植项目", value: 12, amount: "¥10,400" },
    { label: "其他", value: 7, amount: "¥6,200" },
  ],
  schedule: [
    { time: "09:00", name: "王建国", doctor: "李医生", type: "根管治疗", tone: "teal" },
    { time: "09:30", name: "陈晓芳", doctor: "王医生", type: "洁牙", tone: "blue" },
    { time: "10:00", name: "刘志强", doctor: "李医生", type: "种植复诊", tone: "amber" },
    { time: "10:30", name: "赵敏", doctor: "王医生", type: "正畸复诊", tone: "teal" },
    { time: "11:00", name: "孙丽华", doctor: "张医生", type: "牙冠修复", tone: "blue" },
    { time: "14:00", name: "周文博", doctor: "李医生", type: "初诊检查", tone: "teal" },
    { time: "14:30", name: "吴桂英", doctor: "张医生", type: "洁牙", tone: "blue" },
    { time: "15:00", name: "郑凯", doctor: "王医生", type: "拔牙", tone: "amber" },
    { time: "16:00", name: "林静", doctor: "李医生", type: "根管治疗", tone: "teal" },
  ],
  patients: [
    { id: "P-20260801", name: "王建国", gender: "男", age: 46, phone: "138****2314", source: "到店", status: "就诊中", visits: 12 },
    { id: "P-20260802", name: "陈晓芳", gender: "女", age: 31, phone: "139****6620", source: "转介", status: "已预约", visits: 6 },
    { id: "P-20260803", name: "刘志强", gender: "男", age: 52, phone: "136****8891", source: "线上", status: "已完成", visits: 3 },
    { id: "P-20260804", name: "赵敏", gender: "女", age: 27, phone: "137****5502", source: "到店", status: "就诊中", visits: 8 },
    { id: "P-20260805", name: "孙丽华", gender: "女", age: 58, phone: "135****1178", source: "转介", status: "已预约", visits: 15 },
    { id: "P-20260806", name: "周文博", gender: "男", age: 24, phone: "133****9073", source: "线上", status: "已完成", visits: 2 },
    { id: "P-20260807", name: "吴桂英", gender: "女", age: 63, phone: "132****4480", source: "到店", status: "已取消", visits: 5 },
    { id: "P-20260808", name: "郑凯", gender: "男", age: 39, phone: "158****7736", source: "转介", status: "就诊中", visits: 9 },
  ],
  charges: [
    { id: "CHG-20260807-001", patient: "王建国", item: "根管治疗", amount: "¥2,400", method: "微信", status: "已支付", time: "10:24" },
    { id: "CHG-20260807-002", patient: "陈晓芳", item: "洁牙套餐", amount: "¥680", method: "现金", status: "已支付", time: "09:48" },
    { id: "CHG-20260807-003", patient: "刘志强", item: "牙冠修复", amount: "¥3,600", method: "医保", status: "待支付", time: "11:02" },
    { id: "CHG-20260807-004", patient: "赵敏", item: "正畸复诊", amount: "¥1,200", method: "会员卡", status: "已支付", time: "10:15" },
    { id: "CHG-20260807-005", patient: "吴桂英", item: "全口洁牙", amount: "¥520", method: "微信", status: "已退款", time: "09:10" },
    { id: "CHG-20260807-006", patient: "郑凯", item: "拔牙", amount: "¥900", method: "支付宝", status: "待支付", time: "14:36" },
  ],
  queue: {
    waiting: [
      { name: "赵敏", reason: "正畸复诊", time: "10:30" },
      { name: "刘志强", reason: "牙冠修复", time: "11:00" },
      { name: "周文博", reason: "初诊检查", time: "11:20" },
    ],
    inProgress: [
      { name: "王建国", reason: "根管治疗", doctor: "李医生" },
      { name: "郑凯", reason: "拔牙", doctor: "王医生" },
    ],
    done: [
      { name: "陈晓芳", reason: "洁牙", doctor: "王医生" },
      { name: "孙丽华", reason: "复诊检查", doctor: "张医生" },
    ],
  },
  alerts: [
    { title: "库存不足", detail: "树脂材料 C3 低于最低库存，建议补货", tone: "rose" },
    { title: "设备保养到期", detail: "牙科综合治疗椅 #2 需在 3 天内保养", tone: "amber" },
    { title: "今日随访待处理", detail: "3 位患者回访尚未完成", tone: "blue" },
  ],
};
