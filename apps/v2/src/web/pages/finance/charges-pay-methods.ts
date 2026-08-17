import { METHOD_LABELS } from '../../charges/types';
import type { PayMethodNode } from '../../charges/types';

export interface PayMethodSelection {
  payTreeLoaded: boolean;
  payRoots: PayMethodNode[];
  effectivePayRoot: string;
  payLeafOptions: PayMethodNode[];
  effectivePayLeaf: string;
}

function buildFallbackPayMethods(): PayMethodNode[] {
  return Object.entries(METHOD_LABELS).map(([code, label]) => ({
    id: code,
    name: label,
    parentId: null,
    sortOrder: 0,
    active: true,
    remark: null,
    children: [],
  }));
}

export function resolvePayMethodSelection(
  payMethodItems: PayMethodNode[],
  paymentMethodRoot: string,
  paymentMethod: string,
): PayMethodSelection {
  const payTreeLoaded = payMethodItems.length > 0;
  // 未配置缴费方式树时退回内置方式列表（两级下拉的第二级仍以“支付方式”呈现）。
  const fallbackPayMethods = buildFallbackPayMethods();
  const payRoots = payTreeLoaded ? payMethodItems : fallbackPayMethods;
  // payRoots 恒非空：fallbackPayMethods 由 METHOD_LABELS 生成，绝不空
  const effectivePayRoot = payRoots.some((node) => node.id === paymentMethodRoot)
    ? paymentMethodRoot
    : payRoots[0].id;
  const payRootNode = payRoots.find((node) => node.id === effectivePayRoot);
  // effectivePayRoot 必在 payRoots 中，payRootNode 恒存在
  const payLeafOptions = payTreeLoaded
    ? (payRootNode!.children.length > 0 ? payRootNode!.children : [payRootNode!])
    : fallbackPayMethods;
  // payLeafOptions 恒非空：payTreeLoaded 时至少含 [payRootNode]，否则为完整回退列表
  const effectivePayLeaf = payLeafOptions.some((node) => node.id === paymentMethod)
    ? paymentMethod
    : payLeafOptions[0].id;
  return { payTreeLoaded, payRoots, effectivePayRoot, payLeafOptions, effectivePayLeaf };
}
