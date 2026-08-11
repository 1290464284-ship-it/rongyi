/**
 * 弹窗层可访问性辅助：同一容器内只让最上层弹窗保持可交互，
 * 其余兄弟节点（包括更早打开的弹窗）进入 inert，避免键盘/读屏进入后台。
 */
const SKIPPED_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT']);

const containerLayers = new Map<Element, HTMLElement[]>();

function refreshContainer(container: Element): void {
  const layers = containerLayers.get(container) ?? [];
  const top = layers.length > 0 ? layers[layers.length - 1] : null;
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement) || SKIPPED_TAGS.has(child.tagName)) continue;
    const element = child as HTMLElement;
    const activeModal = layers.includes(element);
    const shouldBeInert = activeModal ? element !== top : layers.length > 0;
    if (shouldBeInert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }
}

/**
 * 注册一个弹窗层并返回取消注册函数。
 * 多次注册同一层时按最后一次注册顺序成为最上层。
 */
export function registerModalLayer(layer: HTMLElement): () => void {
  const layerRoot = (layer.closest('.modal-backdrop, .ui-drawer-layer') ?? layer) as HTMLElement;
  const container = layerRoot.parentElement ?? document.body;
  const layers = containerLayers.get(container) ?? [];
  const existing = layers.indexOf(layerRoot);
  if (existing >= 0) layers.splice(existing, 1);
  layers.push(layerRoot);
  containerLayers.set(container, layers);
  refreshContainer(container);
  return () => {
    const current = containerLayers.get(container) ?? [];
    const index = current.indexOf(layerRoot);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) containerLayers.delete(container);
    refreshContainer(container);
  };
}
