import { FormSkeleton } from "@/components/Skeleton";

// /welcome checks sign-in, the application and the kitchen before choosing
// what to show; the server reads have a time limit, so this always ends.
export default function Loading() {
  return <FormSkeleton fields={2} />;
}
