import { Dialog } from './dialog';

export interface HelpDialogsProps {
  showHelp: boolean;
  showOnboarding: boolean;
  onCloseHelp: () => void;
  onCloseOnboarding: () => void;
  onReopenOnboarding: () => void;
}

export function HelpDialogs({
  showHelp,
  showOnboarding,
  onCloseHelp,
  onCloseOnboarding,
  onReopenOnboarding,
}: HelpDialogsProps) {
  return (
    <>
      <Dialog open={showHelp} title="快捷键与帮助" onClose={onCloseHelp}>
        <ul className="help-list">
          <li>Ctrl+K：聚焦全局搜索（患者/收费/库存/预约等跨模块）</li>
          <li>？：打开快捷键帮助</li>
          <li>Tab / Shift+Tab：表单和弹窗内焦点移动</li>
          <li>Esc：关闭弹窗</li>
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onReopenOnboarding}>重新查看新手引导</button>
          <button type="button" className="btn-secondary" onClick={onCloseHelp}>关闭</button>
        </div>
      </Dialog>
      <Dialog open={showOnboarding} title="新手引导" onClose={onCloseOnboarding}>
        <ol className="help-list">
          <li>从左侧菜单进入患者、临床、财务、库存等模块。</li>
          <li>患者档案支持联系方式、微信号和自定义字段。</li>
          <li>系统会按提醒设置生成随访，可到“随访微信”查看。</li>
          <li>重要操作前建议先做一次加密备份。</li>
        </ol>
        <div className="modal-actions">
          <button type="button" onClick={onCloseOnboarding}>完成</button>
        </div>
      </Dialog>
    </>
  );
}
