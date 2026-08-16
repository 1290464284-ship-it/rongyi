// 模拟库管理员密码的消费端单一来源。
// 契约源头：scripts/simulate-clinic-data.ts 将模拟库密码固定写入
// V2_ADMIN_PASSWORD = 'v2-sim-admin-password'（seed 时落库）。
// 脚本侧统一从这里取默认值，改契约时只需同步这两处。
export const SIM_ADMIN_PASSWORD = 'v2-sim-admin-password';

export function simAdminPassword() {
  return process.env.V2_ADMIN_PASSWORD ?? SIM_ADMIN_PASSWORD;
}
