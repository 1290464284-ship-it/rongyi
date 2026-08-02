/* eslint-disable no-irregular-whitespace -- 中文排版用全角空格 */
export const DEFAULT_PRESCRIPTION_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 20px; font-size: 12px; color: #333; }
  .clinic-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 15px; }
  .clinic-logo { max-height: 60px; margin-bottom: 5px; }
  .clinic-name { font-size: 18px; font-weight: bold; }
  .clinic-info { font-size: 11px; color: #666; margin-top: 5px; }
  .prescription-title { text-align: center; font-size: 16px; font-weight: bold; margin: 15px 0; }
  .patient-info { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px; padding: 8px; background: #f9f9f9; border: 1px solid #eee; }
  .patient-info div { flex: 1 1 30%; }
  .label { color: #666; }
  .rx-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .rx-table th, .rx-table td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  .rx-table th { background: #f5f5f5; font-weight: bold; }
  .warning-alert { background: #ffeaea; color: #c00; border: 1px solid #f99; padding: 8px; margin: 10px 0; border-radius: 3px; }
  .advice { margin: 15px 0; padding: 10px; background: #fafafa; border-left: 3px solid #4a90d9; }
  .advice-title { font-weight: bold; margin-bottom: 5px; }
  .signature-section { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign-box { width: 40%; border-top: 1px solid #333; padding-top: 5px; text-align: center; color: #666; }
</style>
</head>
<body>
  <div class="clinic-header">
    {{#if clinic.logo}}<img class="clinic-logo" src="{{{clinic.logo}}}" alt="logo">{{/if}}
    <div class="clinic-name">{{clinic.name}}</div>
    <div class="clinic-info">
      {{#if clinic.address}}地址：{{clinic.address}}　{{/if}}
      {{#if clinic.phone}}电话：{{clinic.phone}}{{/if}}
    </div>
  </div>
  <div class="prescription-title">处　方　笺</div>
  <div class="patient-info">
    <div><span class="label">姓名：</span>{{patient.name}}</div>
    <div><span class="label">性别：</span>{{patient.gender}}</div>
    <div><span class="label">年龄：</span>{{patient.age}}</div>
    <div><span class="label">处方编号：</span>{{prescription.code}}</div>
    <div><span class="label">就诊日期：</span>{{prescription.date}}</div>
    <div><span class="label">科室：</span>口腔科</div>
  </div>
  {{#if warnings}}
  <div class="warning-alert">
    <strong>配伍禁忌警示：</strong>
    {{#each warnings}}
    <div>【{{this.level}}】{{this.message}}</div>
    {{/each}}
  </div>
  {{/if}}
  <table class="rx-table">
    <thead>
      <tr>
        <th style="width:5%">序号</th>
        <th style="width:15%">药品编码</th>
        <th style="width:25%">药品名称</th>
        <th style="width:10%">规格</th>
        <th style="width:10%">数量</th>
        <th style="width:15%">用法用量</th>
        <th style="width:20%">频次/天数</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{@index}}1</td>
        <td>{{this.drugCode}}</td>
        <td>{{this.drugName}}</td>
        <td>{{this.spec}}</td>
        <td>{{this.quantity}} {{this.unit}}</td>
        <td>{{this.dosage}}</td>
        <td>{{this.frequency}} / {{this.days}}天</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  {{#if prescription.remark}}
  <div class="advice">
    <div class="advice-title">医嘱：</div>
    <div>{{prescription.remark}}</div>
  </div>
  {{/if}}
  <div class="signature-section">
    <div class="sign-box">
      医生签名：{{doctor.name}}
    </div>
    <div class="sign-box">
      日期：{{prescription.date}}
    </div>
  </div>
</body>
</html>`;

export const DEFAULT_RECEIPT_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 20px; font-size: 12px; color: #333; }
  .header { text-align: center; border-bottom: 2px dashed #999; padding-bottom: 10px; margin-bottom: 15px; }
  .clinic-name { font-size: 16px; font-weight: bold; }
  .clinic-info { font-size: 11px; color: #666; margin-top: 5px; }
  .receipt-title { text-align: center; font-size: 18px; font-weight: bold; margin: 10px 0; }
  .meta-row { display: flex; justify-content: space-between; margin: 5px 0; padding: 3px 0; }
  .patient-bar { background: #f9f9f9; padding: 8px; margin: 10px 0; border: 1px solid #eee; }
  .items-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  .items-table th, .items-table td { border: 1px solid #ddd; padding: 6px 4px; }
  .items-table th { background: #f5f5f5; font-size: 11px; }
  .items-table td.num { text-align: right; }
  .total-box { margin: 15px 0; padding: 10px; border: 2px solid #333; background: #fafafa; }
  .total-row { display: flex; justify-content: space-between; margin: 4px 0; }
  .total-row.grand { font-size: 14px; font-weight: bold; color: #c00; border-top: 1px solid #999; padding-top: 6px; margin-top: 6px; }
  .payment-info { margin: 10px 0; padding: 8px; background: #f5faff; border: 1px solid #ccddee; }
  .stamp-area { display: flex; justify-content: space-between; margin-top: 40px; }
  .stamp-box { width: 30%; border: 1px dashed #999; height: 80px; display: flex; align-items: center; justify-content: center; color: #999; }
  .footer-text { text-align: center; margin-top: 20px; font-size: 11px; color: #999; border-top: 1px dashed #ccc; padding-top: 8px; }
</style>
</head>
<body>
  <div class="header">
    <div class="clinic-name">{{clinic.name}}</div>
    <div class="clinic-info">
      {{#if clinic.address}}{{clinic.address}}　{{/if}}
      {{#if clinic.phone}}TEL: {{clinic.phone}}{{/if}}
    </div>
  </div>
  <div class="receipt-title">— 收　费　凭　证 —</div>
  <div class="meta-row">
    <span><strong>收据编号：</strong>{{charge.number}}</span>
    <span><strong>日期：</strong>{{charge.date}}</span>
  </div>
  <div class="patient-bar">
    <div class="meta-row">
      <span><strong>患者姓名：</strong>{{patient.name}}</span>
      <span><strong>联系电话：</strong>{{patient.phone}}</span>
      <span><strong>就诊医生：</strong>{{doctor.name}}</span>
    </div>
  </div>
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:12%">编码</th>
        <th style="width:30%">项目名称</th>
        <th style="width:8%">数量</th>
        <th style="width:15%">单价(¥)</th>
        <th style="width:15%">小计(¥)</th>
        <th style="width:20%">牙位</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{this.code}}</td>
        <td>{{this.name}}</td>
        <td class="num">{{this.quantity}}</td>
        <td class="num">{{this.price}}</td>
        <td class="num">{{this.subtotal}}</td>
        <td>{{#each this.teethNumbers}}{{this}} {{/each}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div class="total-box">
    <div class="total-row"><span>项目合计：</span><span>¥ {{totals.totalAmount}}</span></div>
    <div class="total-row"><span>折扣优惠：</span><span>-¥ {{totals.discount}}</span></div>
    <div class="total-row"><span>应收金额：</span><span>¥ {{totals.receivable}}</span></div>
    <div class="total-row grand"><span>实收金额：</span><span>¥ {{totals.paidAmount}}</span></div>
    {{#if totals.changeAmount}}
    <div class="total-row"><span>找零：</span><span>¥ {{totals.changeAmount}}</span></div>
    {{/if}}
  </div>
  <div class="payment-info">
    <div class="meta-row">
      <span><strong>支付方式：</strong>{{#each payments}}{{this.method}} ¥{{this.amount}}；{{/each}}</span>
      <span><strong>收费状态：</strong>{{charge.status}}</span>
    </div>
  </div>
  <div class="stamp-area">
    <div class="stamp-box">收款盖章处</div>
    <div class="stamp-box">患者签名</div>
    <div class="stamp-box">经办人</div>
  </div>
  <div class="footer-text">
    此凭证为收费依据，请妥善保管。如有疑问，请在7日内咨询。
    <br>打印时间：{{charge.printTime}}
  </div>
</body>
</html>`;

export const DEFAULT_TREATMENT_PLAN_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 20px; font-size: 12px; color: #333; }
  .clinic-header { text-align: center; border-bottom: 2px solid #4a90d9; padding-bottom: 10px; margin-bottom: 15px; }
  .clinic-name { font-size: 18px; font-weight: bold; color: #2c5282; }
  .title { text-align: center; font-size: 20px; font-weight: bold; margin: 15px 0; color: #2c5282; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px; background: #f5f9ff; border: 1px solid #cce0ff; }
  .info-item { display: flex; }
  .info-item .label { color: #666; width: 70px; flex-shrink: 0; }
  .progress-bar-wrap { background: #e0e0e0; height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0; }
  .progress-bar-fill { background: linear-gradient(90deg, #4a90d9, #68d391); height: 100%; transition: width .3s; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: bold; }
  .plan-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
  .plan-table th, .plan-table td { border: 1px solid #dde5ee; padding: 6px 8px; }
  .plan-table th { background: #ebf4ff; font-weight: bold; color: #2c5282; }
  .status-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
  .status-PLANNED { background: #e0e0e0; color: #555; }
  .status-IN_PROGRESS { background: #fff3cd; color: #856404; }
  .status-COMPLETED { background: #d4edda; color: #155724; }
  .status-CANCELLED { background: #f8d7da; color: #721c24; }
  .summary-row { display: flex; justify-content: space-between; margin: 6px 0; padding: 4px 8px; }
  .summary-row.alt { background: #f5f9ff; }
  .doctor-notes { margin: 15px 0; padding: 12px; border: 1px dashed #4a90d9; background: #fafcff; }
  .notes-title { font-weight: bold; color: #2c5282; margin-bottom: 6px; }
  .signature-area { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign-col { width: 30%; text-align: center; }
  .sign-line { border-top: 1px solid #333; margin-top: 30px; padding-top: 5px; color: #666; }
</style>
</head>
<body>
  <div class="clinic-header">
    <div class="clinic-name">{{clinic.name}} · 治疗计划单</div>
  </div>
  <div class="title">{{plan.name}}</div>
  <div class="info-grid">
    <div class="info-item"><span class="label">患者姓名：</span>{{patient.name}}</div>
    <div class="info-item"><span class="label">性别/年龄：</span>{{patient.gender}} / {{patient.age}}</div>
    <div class="info-item"><span class="label">联系电话：</span>{{patient.phone}}</div>
    <div class="info-item"><span class="label">方案编号：</span>{{plan.code}}</div>
    <div class="info-item"><span class="label">主治医生：</span>{{doctor.name}}</div>
    <div class="info-item"><span class="label">创建日期：</span>{{plan.createdAt}}</div>
    <div class="info-item"><span class="label">方案状态：</span>{{plan.status}}</div>
    <div class="info-item"><span class="label">预计完成：</span>{{plan.estimatedEndDate}}</div>
    <div class="info-item"><span class="label">总费用：</span>¥ {{plan.totalFee}}</div>
  </div>
  <div style="margin-top: 15px;">
    <div style="margin-bottom: 5px;"><strong>疗程完成度：{{progress.completionPercent}}%</strong></div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width: {{progress.completionPercent}}%;">{{progress.completedItems}}/{{progress.totalItems}} 项</div>
    </div>
  </div>
  <table class="plan-table">
    <thead>
      <tr>
        <th style="width:6%">序号</th>
        <th style="width:12%">编码</th>
        <th style="width:25%">项目名称</th>
        <th style="width:6%">数量</th>
        <th style="width:10%">单价(¥)</th>
        <th style="width:12%">小计(¥)</th>
        <th style="width:15%">牙位</th>
        <th style="width:14%">状态</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{@index}}1</td>
        <td>{{this.code}}</td>
        <td>{{this.name}}</td>
        <td>{{this.quantity}}</td>
        <td>{{this.price}}</td>
        <td>{{this.subtotal}}</td>
        <td>{{#each this.teethNumbers}}{{this}} {{/each}}</td>
        <td><span class="status-badge status-{{this.status}}">{{this.statusLabel}}</span></td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div style="border: 1px solid #dde5ee; margin: 15px 0;">
    <div class="summary-row alt"><span>方案总费用：</span><strong>¥ {{finance.totalFee}}</strong></div>
    <div class="summary-row"><span>已收金额：</span><span style="color: #155724;">¥ {{finance.paidAmount}}</span></div>
    <div class="summary-row alt"><span>应收余款：</span><span style="color: #c00; font-weight: bold;">¥ {{finance.outstandingAmount}}</span></div>
  </div>
  {{#if plan.remark}}
  <div class="doctor-notes">
    <div class="notes-title">医生说明：</div>
    <div>{{plan.remark}}</div>
  </div>
  {{/if}}
  <div class="signature-area">
    <div class="sign-col"><div class="sign-line">医生签名</div></div>
    <div class="sign-col"><div class="sign-line">患者/家属签名</div></div>
    <div class="sign-col"><div class="sign-line">日期：{{plan.createdAt}}</div></div>
  </div>
</body>
</html>`;

export const DEFAULT_CLINIC_REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 20px; font-size: 12px; color: #333; }
  .report-header { text-align: center; border-bottom: 3px double #2c5282; padding-bottom: 12px; margin-bottom: 20px; }
  .clinic-brand { font-size: 20px; font-weight: bold; color: #2c5282; }
  .report-title { font-size: 24px; font-weight: bold; margin: 8px 0; letter-spacing: 4px; }
  .report-period { color: #666; font-size: 13px; }
  .section { margin: 18px 0; }
  .section-title { font-size: 14px; font-weight: bold; color: #2c5282; border-left: 4px solid #4a90d9; padding-left: 8px; margin-bottom: 10px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .kpi-card { border: 1px solid #dde5ee; padding: 12px 8px; text-align: center; background: #fafcff; border-radius: 4px; }
  .kpi-value { font-size: 20px; font-weight: bold; color: #2c5282; }
  .kpi-label { font-size: 11px; color: #666; margin-top: 4px; }
  .kpi-value.green { color: #155724; }
  .kpi-value.orange { color: #856404; }
  .kpi-value.red { color: #c00; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .data-table { width: 100%; border-collapse: collapse; }
  .data-table th, .data-table td { border: 1px solid #dde5ee; padding: 6px 8px; }
  .data-table th { background: #ebf4ff; font-weight: bold; color: #2c5282; font-size: 11px; }
  .data-table tr:nth-child(even) td { background: #fafcff; }
  .rank-1 { color: #c00; font-weight: bold; }
  .rank-2 { color: #e67300; font-weight: bold; }
  .rank-3 { color: #cc9900; font-weight: bold; }
  .chart-box { border: 1px solid #dde5ee; padding: 10px; background: #fafcff; border-radius: 4px; }
  .chart-title { font-weight: bold; margin-bottom: 8px; color: #2c5282; }
  .trend-row { display: flex; align-items: center; margin: 4px 0; gap: 8px; }
  .trend-label { width: 50px; font-size: 11px; color: #666; }
  .trend-bar-wrap { flex: 1; background: #e8edf5; height: 16px; border-radius: 3px; }
  .trend-bar-fill { background: linear-gradient(90deg, #4a90d9, #68d391); height: 100%; border-radius: 3px; }
  .trend-value { width: 70px; text-align: right; font-size: 11px; }
  .alert-list { list-style: none; padding: 0; margin: 0; }
  .alert-item { padding: 6px 10px; margin: 4px 0; border-left: 3px solid #e74c3c; background: #ffeaea; font-size: 12px; }
  .alert-item.warn { border-left-color: #f39c12; background: #fff8e6; }
  .alert-item.info { border-left-color: #3498db; background: #eaf4ff; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #dde5ee; color: #999; font-size: 11px; text-align: center; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="clinic-brand">{{clinic.name}} · 经营数据月报</div>
    <div class="report-title">诊 所 月 度 报 告</div>
    <div class="report-period">统计周期：{{report.period}}　　生成时间：{{report.generatedAt}}</div>
  </div>
  <div class="section">
    <div class="section-title">核心经营指标 KPI</div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">{{kpi.totalVisits}}</div>
        <div class="kpi-label">总就诊人次</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value green">{{kpi.totalRevenue}}</div>
        <div class="kpi-label">本月总收入(¥)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value orange">{{kpi.avgOrderValue}}</div>
        <div class="kpi-label">平均客单价(¥)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value {{#if kpi.npsLt70}}red{{else}}green{{/if}}">{{kpi.nps}}</div>
        <div class="kpi-label">NPS 净推荐值</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value green">{{kpi.newPatients}}</div>
        <div class="kpi-label">新增患者数</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value {{#if kpi.revisitLt40}}orange{{else}}green{{/if}}">{{kpi.revisitRate}}%</div>
        <div class="kpi-label">复诊率</div>
      </div>
    </div>
  </div>
  <div class="two-col">
    <div class="section">
      <div class="section-title">医生业绩排名 TOP5</div>
      <table class="data-table">
        <thead>
          <tr><th style="width:8%">排名</th><th style="width:30%">医生姓名</th><th>接诊量</th><th>业绩(¥)</th><th>满意度</th></tr>
        </thead>
        <tbody>
          {{#each topDoctors}}
          <tr>
            <td class="rank-{{this.rank}}">{{this.rank}}</td>
            <td>{{this.name}}</td>
            <td>{{this.visitCount}}</td>
            <td>{{this.revenue}}</td>
            <td>{{this.satisfaction}}%</td>
          </tr>
          {{/each}}
          {{#if topDoctorsEmpty}}
          <tr><td colspan="5" style="text-align:center;color:#999;padding:15px;">暂无数据</td></tr>
          {{/if}}
        </tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-title">库存报警 TOP10</div>
      <table class="data-table">
        <thead>
          <tr><th style="width:8%">序</th><th style="width:35%">商品名称</th><th>库存</th><th>安全线</th><th>状态</th></tr>
        </thead>
        <tbody>
          {{#each lowStockItems}}
          <tr>
            <td>{{@index}}1</td>
            <td>{{this.name}}</td>
            <td style="color:#c00;font-weight:bold;">{{this.stock}}</td>
            <td>{{this.safetyStock}}</td>
            <td>{{this.status}}</td>
          </tr>
          {{/each}}
          {{#if lowStockEmpty}}
          <tr><td colspan="5" style="text-align:center;color:#999;padding:15px;">暂无报警</td></tr>
          {{/if}}
        </tbody>
      </table>
    </div>
  </div>
  <div class="two-col">
    <div class="section">
      <div class="section-title">经营异常预警</div>
      <ul class="alert-list">
        {{#each alerts}}
        <li class="alert-item {{this.level}}">{{this.title}}：{{this.description}}</li>
        {{/each}}
        {{#if alertsEmpty}}
        <li class="alert-item info">当前无异常预警，经营状态良好。</li>
        {{/if}}
      </ul>
    </div>
    <div class="section">
      <div class="chart-box">
        <div class="chart-title">近30天收入趋势（单位：¥）</div>
        {{#each revenueTrend}}
        <div class="trend-row">
          <div class="trend-label">{{this.date}}</div>
          <div class="trend-bar-wrap"><div class="trend-bar-fill" style="width: {{this.percent}}%;"></div></div>
          <div class="trend-value">{{this.value}}</div>
        </div>
        {{/each}}
      </div>
    </div>
  </div>
  <div class="footer">
    {{clinic.name}} · {{report.period}} 经营月报 · 本报告由系统自动生成 · 机密文件请勿外传
  </div>
</body>
</html>`;
