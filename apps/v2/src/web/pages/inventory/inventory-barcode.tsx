import { useState } from 'react';
import { apiRequest } from '../../lib/api';
import type { Page } from '../../lib/types';
import { errorMessage } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

/** 条码扫码定位表单：自持输入状态，命中后经 onLocated 回传项目 id。 */
export function BarcodeSearch({ onLocated }: { onLocated: (id: string) => void }) {
  const { showToast } = useToast();
  const [barcodeSearch, setBarcodeSearch] = useState('');

  async function searchByBarcode() {
    const value = barcodeSearch.trim();
    if (!value) {
      showToast('请输入条码或编码', 'error');
      return;
    }
    try {
      // 扫码定位优先走服务端精确过滤（code/barcode 等值），不受前 20 条截断影响；
      // 通用列表对已声明字段支持 `?field=value` 精确过滤。
      const [byCode, byBarcode] = await Promise.all([
        apiRequest<Page<Record<string, unknown>>>(
          `/resources/inventoryItems?page=1&pageSize=1&code=${encodeURIComponent(value)}`),
        apiRequest<Page<Record<string, unknown>>>(
          `/resources/inventoryItems?page=1&pageSize=1&barcode=${encodeURIComponent(value)}`),
      ]);
      const exact = (byCode.items ?? []).find((row) => String(row.code ?? '') === value)
        ?? (byBarcode.items ?? []).find((row) => String(row.barcode ?? '') === value);
      if (exact) {
        onLocated(String(exact.id));
        showToast(`已定位：${String(exact.name ?? exact.code ?? '')}`, 'success');
        return;
      }
      // 精确未命中再退化为全文搜索（兼容手输部分编码/名称的场景）。
      const result = await apiRequest<Page<Record<string, unknown>>>(
        `/resources/inventoryItems?page=1&pageSize=20&search=${encodeURIComponent(value)}`,
      );
      const match = (result.items ?? []).find((row) =>
        String(row.barcode ?? '') === value || String(row.code ?? '') === value);
      if (!match) {
        showToast('未找到匹配的库存项目', 'error');
        return;
      }
      onLocated(String(match.id));
      showToast(`已定位：${String(match.name ?? match.code ?? '')}`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '扫码定位失败'), 'error');
    }
  }

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void searchByBarcode();
      }}
    >
      <input
        aria-label="条码扫码"
        placeholder="扫描条码或输入编码"
        value={barcodeSearch}
        onChange={(event) => setBarcodeSearch(event.target.value)}
      />
      <button type="submit">扫码定位</button>
    </form>
  );
}
