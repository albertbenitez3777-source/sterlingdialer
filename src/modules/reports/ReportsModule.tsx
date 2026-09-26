import type { ComponentProps } from 'react';
import { ModuleBoundary } from '@/app/ModuleBoundary';
import { AdminCharts } from '@/components/Charts';
import { OperationsDashboard } from '@/components/OperationsDashboard';
import { ReportedMetrics } from '@/app/views/ReportedMetrics';
import { OwnerAlertOverview } from '@/components/OwnerAlertOverview';

// Keep section recovery local: never reload the page or restart the phone.
export function AdminChartsModule(props: ComponentProps<typeof AdminCharts>) {
 return <ModuleBoundary name="Charts"><AdminCharts {...props} /></ModuleBoundary>;
}
export function OperationsDashboardModule(props: ComponentProps<typeof OperationsDashboard>) {
 return <ModuleBoundary name="Call statistics"><OperationsDashboard {...props} /></ModuleBoundary>;
}
export function ReportedMetricsModule(props: ComponentProps<typeof ReportedMetrics>) {
 return <ModuleBoundary name="Detailed statistics"><ReportedMetrics {...props} /></ModuleBoundary>;
}
export function OwnerAlertOverviewModule(props: ComponentProps<typeof OwnerAlertOverview>) {
 return <ModuleBoundary name="Team alerts"><OwnerAlertOverview {...props} /></ModuleBoundary>;
}
