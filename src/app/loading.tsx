import { DashboardSkeleton } from "@/components/Skeleton";

// "/" resolves the signed-in partner's role, application and kitchen before
// choosing a screen; most of the time that screen is an orders/deliveries list.
export default function Loading() {
  return <DashboardSkeleton />;
}
