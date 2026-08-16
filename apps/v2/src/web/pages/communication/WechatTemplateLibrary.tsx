import { useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { useToast } from '../../lib/toast-context';

export interface WechatTemplateConfig {
  enabled?: boolean;
  appointmentDaysBefore?: number;
  recallDaysAfter?: number;
  firstExamDaysAfter?: number;
  appointmentContent?: string;
  recallContent?: string;
  firstExamContent?: string;
}

interface TemplateScene {
  key: 'appointment' | 'recall' | 'firstExam';
  title: string;
  contentKey: keyof Pick<WechatTemplateConfig, 'appointmentContent' | 'recallContent' | 'firstExamContent'>;
  placeholders: Array<{ token: string; example: string }>;
}

const DEFAULT_CONTENT: Pick<WechatTemplateConfig, 'appointmentContent' | 'recallContent' | 'firstExamContent'> = {
  appointmentContent: '{patientName}您好，您明天 {appointmentTime} 预约了复诊，请按时到诊；如需调整时间请提前联系诊所。',
  recallContent: '{patientName}您好，您上次治疗已过去 {days} 天，恢复情况怎么样？如有不适请及时联系我们。',
  firstExamContent: '{patientName}您好，上次您来诊所咨询后，不知您考虑得怎么样了？如需进一步了解治疗方案，欢迎随时联系我们。',
};

const SCENES: TemplateScene[] = [
  {
    key: 'appointment',
    title: '预约提醒',
    contentKey: 'appointmentContent',
    placeholders: [
      { token: '{patientName}', example: '张女士' },
      { token: '{appointmentTime}', example: '明天 09:30' },
    ],
  },
  {
    key: 'recall',
    title: '治疗回访',
    contentKey: 'recallContent',
    placeholders: [
      { token: '{patientName}', example: '李先生' },
      { token: '{days}', example: '3' },
    ],
  },
  {
    key: 'firstExam',
    title: '首诊跟进',
    contentKey: 'firstExamContent',
    placeholders: [{ token: '{patientName}', example: '王女士' }],
  },
];

function renderSample(content: string, placeholders: TemplateScene['placeholders']): string {
  return placeholders.reduce((acc, placeholder) => acc.replaceAll(placeholder.token, () => placeholder.example), content);
}

export function WechatTemplateLibrary({ config }: { config?: WechatTemplateConfig }) {
  const { showToast } = useToast();
  const [copyingKey, setCopyingKey] = useState<string | null>(null);

  async function copyTemplate(key: string, text: string) {
    /* v8 ignore next -- 复制按钮在 copyingKey 命中时 disabled，双击不可达 */
    if (copyingKey) return;
    setCopyingKey(key);
    try {
      await copyText(text);
      showToast('模板已复制', 'success');
    } catch {
      showToast('复制失败，请手动选择复制', 'error');
    } finally {
      setCopyingKey(null);
    }
  }

  return (
    <section className="wechat-template-section">
      <h2>微信信息模板</h2>
      <div className="wechat-template-grid">
        {SCENES.map((scene) => {
          /* v8 ignore next -- DEFAULT_CONTENT 为三个 contentKey 均提供非空默认文案，`|| ''` 仅用于 noUncheckedIndexedAccess 的类型收窄，运行期死代码 */
          const content = config?.[scene.contentKey]?.trim() || DEFAULT_CONTENT[scene.contentKey] || '';
          const sample = renderSample(content, scene.placeholders);
          return (
            <article className="wechat-template-card" key={scene.key}>
              <header className="wechat-template-head">
                <strong>{scene.title}</strong>
                <span className="tag">{scene.placeholders.map((placeholder) => placeholder.token).join(' ')}</span>
              </header>
              <pre className="wechat-template-content">{content}</pre>
              <p className="wechat-template-sample">{sample}</p>
              <div className="wechat-template-actions">
                <button disabled={copyingKey === scene.key} onClick={() => void copyTemplate(scene.key, content)}>
                  <Copy size={14} />
                  {copyingKey === scene.key ? '复制中...' : '复制模板'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
