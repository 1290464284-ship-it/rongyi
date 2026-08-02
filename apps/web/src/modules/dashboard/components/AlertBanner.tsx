/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  useAlertCounts,
  useLatestAlerts,
  SEVERITY_BANNER_CLASS,
  type AlertSeverity,
  type BusinessAlert,
} from '@/lib/api/system/business-alerts';

function getHighestSeverity(alerts: BusinessAlert[]): AlertSeverity {
  const priority: AlertSeverity[] = ['CRITICAL', 'ERROR', 'WARN', 'INFO'];
  for (const s of priority) {
    if (alerts.some((a) => a.severity === s)) return s;
  }
  return 'INFO';
}

export default function AlertBanner() {
  const nav = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const { data: counts, isLoading: countsLoading } = useAlertCounts({
    retry: false,
  });
  const { data: latest = [], isLoading: latestLoading } = useLatestAlerts('WARN,CRITICAL,ERROR', {
    retry: false,
  });

  const openCount = counts?.open ?? 0;
  const criticalCount = counts?.critical ?? 0;
  const hasAlerts = !countsLoading && !dismissed && (openCount > 0 || latest.length > 0);

  const severity = useMemo<AlertSeverity>(() => {
    if (criticalCount > 0) return 'CRITICAL';
    if (latest.length > 0) return getHighestSeverity(latest);
    return 'WARN';
  }, [criticalCount, latest]);

  const bannerClass = SEVERITY_BANNER_CLASS[severity];

  useEffect(() => {
    if (latest.length <= 1) return;
    const timer = setInterval(() => {
      setCarouselIndex((i) => (i + 1) % latest.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [latest.length]);

  const currentAlert = latest[carouselIndex];

  if (!hasAlerts) return null;

  const goToAlertsPage = (severityFilter?: AlertSeverity) => {
    nav('/business-alerts');
    if (severityFilter) {
      setSearchParams({ severity: severityFilter });
    }
  };

  return (
    <div
      data-testid="alert-banner"
      className={`${bannerClass} relative px-4 py-3 rounded-lg shadow-sm flex items-center gap-3`}
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-2">
          <span>当前 {openCount} 条未解决</span>
          {criticalCount > 0 && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
              {criticalCount} 条严重
            </span>
          )}
        </div>
        {currentAlert && (
          <div
            className="text-xs mt-1 opacity-90 truncate"
            title={currentAlert.message}
            data-testid="alert-banner-message"
          >
            {currentAlert.message}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          data-testid="alert-banner-detail-btn"
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/20 border border-white/30"
          onClick={() => goToAlertsPage(severity === 'CRITICAL' ? 'CRITICAL' : undefined)}
        >
          查看详情
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
        <button
          data-testid="alert-banner-dismiss"
          className="text-white/80 hover:text-white p-1 rounded transition-colors"
          onClick={() => setDismissed(true)}
          aria-label="关闭告警"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
