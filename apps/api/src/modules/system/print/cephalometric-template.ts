/* eslint-disable no-irregular-whitespace -- 中文排版用全角空格 */
export const DEFAULT_CEPHALOMETRIC_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Microsoft YaHei", sans-serif; margin: 20px; font-size: 12px; color: #333; }
  .clinic-header { text-align: center; border-bottom: 2px solid #2c5282; padding-bottom: 10px; margin-bottom: 15px; }
  .clinic-name { font-size: 18px; font-weight: bold; color: #2c5282; }
  .clinic-info { font-size: 11px; color: #666; margin-top: 5px; }
  .title { text-align: center; font-size: 20px; font-weight: bold; margin: 15px 0; color: #2c5282; letter-spacing: 4px; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px; background: #f5f9ff; border: 1px solid #cce0ff; margin-bottom: 15px; }
  .info-item .label { color: #666; }
  .section-title { font-size: 14px; font-weight: bold; color: #2c5282; border-left: 4px solid #4a90d9; padding-left: 8px; margin: 15px 0 8px 0; }
  .meas-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .meas-table th, .meas-table td { border: 1px solid #dde5ee; padding: 5px 6px; text-align: center; font-size: 11px; }
  .meas-table th { background: #ebf4ff; color: #2c5282; }
  .sev-NORMAL { color: #155724; }
  .sev-MILD { color: #856404; }
  .sev-MODERATE { color: #e67300; font-weight: bold; }
  .sev-SEVERE { color: #c00; font-weight: bold; background: #ffeaea; }
  .summary-box { padding: 10px; background: #fafcff; border: 1px solid #4a90d9; margin: 10px 0; border-radius: 4px; }
  .flags-box { padding: 8px; background: #fff8e6; border-left: 4px solid #f39c12; margin: 10px 0; }
  .comparison-section { margin-top: 15px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .svg-box { border: 1px solid #dde5ee; background: #fafafa; padding: 5px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #dde5ee; color: #999; font-size: 11px; text-align: center; }
  .summary-row { display: flex; justify-content: space-between; margin: 4px 0; }
</style>
</head>
<body>
  <div class="clinic-header">
    {{#if clinic.logo}}<img style="max-height:50px;" src="{{{clinic.logo}}}" alt="logo">{{/if}}
    <div class="clinic-name">{{clinic.name}}</div>
    <div class="clinic-info">
      {{#if clinic.address}}地址：{{clinic.address}}　{{/if}}
      {{#if clinic.phone}}电话：{{clinic.phone}}{{/if}}
    </div>
  </div>
  <div class="title">头影测量分析报告</div>
  <div class="info-grid">
    <div class="info-item"><span class="label">患者姓名：</span>{{patient.name}}</div>
    <div class="info-item"><span class="label">性别/年龄：</span>{{patient.gender}} / {{patient.birthDate}}</div>
    <div class="info-item"><span class="label">联系电话：</span>{{patient.phone}}</div>
    <div class="info-item"><span class="label">分析名称：</span>{{analysis.name}}</div>
    <div class="info-item"><span class="label">检查日期：</span>{{analysis.createdAt}}</div>
    <div class="info-item"><span class="label">标注验证：</span>{{#if analysis.landmarksValidated}}已确认{{else}}待确认{{/if}}</div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-title">测量指标（共 {{measurementsSummary.total}} 项 / 有效 {{measurementsSummary.valid}} 项）</div>
      <table class="meas-table">
        <thead><tr><th>项目</th><th>数值</th><th>均值</th><th>偏差</th><th>严重度</th></tr></thead>
        <tbody>
          {{#each measurements}}
          <tr>
            <td>{{this.label}}</td>
            <td>{{this.value}}{{this.unit}}</td>
            <td>{{this.norm}}{{this.unit}}</td>
            <td>{{this.delta}}</td>
            <td class="sev-{{this.severity}}">{{this.severity}}</td>
          </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    <div>
      <div class="section-title">头影影像示意</div>
      <div class="svg-box">{{{landmarksSvg}}}</div>
      <div class="section-title" style="margin-top:15px;">分类摘要</div>
      <div class="summary-box">
        <div style="font-weight:bold;font-size:14px;color:#2c5282;">{{classification.summary}}</div>
        <div class="summary-row"><span>骨型分类：</span><strong>{{classification.skeletal}}</strong></div>
        <div class="summary-row"><span>牙型分类：</span><strong>{{classification.dental}}</strong></div>
        <div class="summary-row"><span>垂直生长型：</span><strong>{{classification.vertical}}</strong></div>
      </div>
      {{#if classification.issueFlags}}
      <div class="flags-box">
        <strong>异常提示：</strong>
        {{#each classification.issueFlags}}
        <div>[{{this.severity}}] {{this.msg}} ({{this.value}} / 均值{{this.norm}})</div>
        {{/each}}
      </div>
      {{/if}}
    </div>
  </div>

  {{#if comparison}}
  <div class="comparison-section">
    <div class="section-title">模板对比：{{comparison.template}}</div>
    <table class="meas-table">
      <thead><tr><th>项目</th><th>实测</th><th>模板均值</th><th>SD</th><th>偏差</th><th>严重度</th></tr></thead>
      <tbody>
        {{#each comparison.deltas}}
        <tr>
          <td>{{this.label}}</td>
          <td>{{this.value}}</td>
          <td>{{this.mean}}</td>
          <td>{{this.sd}}</td>
          <td>{{this.delta}}</td>
          <td class="sev-{{this.severity}}">{{this.severity}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    <div class="summary-box" style="margin-top:8px;"><strong>对比结论：</strong>{{comparison.summary}}</div>
  </div>
  {{/if}}

  {{#if analysis.notes}}
  <div class="section-title">备注</div>
  <div style="padding:8px;background:#fafafa;border-left:4px solid #68d391;">{{analysis.notes}}</div>
  {{/if}}

  <div class="footer">
    报告生成时间：{{generatedAt}}　·　医生：{{doctor.name}}
    <br>{{clinic.name}} · 头影测量报告 · 本报告为临床参考，需结合其他检查综合判断
  </div>
</body>
</html>`;
