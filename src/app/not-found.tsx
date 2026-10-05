import { StatusScreen } from "@/components/StatusScreen";

// Next's built-in 404 is a fixed 100vh, which would overflow under the global
// Home/Back bar; this one uses the same page-height convention as every screen.
export default function NotFound() {
  return (
    <StatusScreen
      tone="warning"
      signOut="if-signed-in"
      title="Page not found"
      message="That page doesn't exist. Use Home above to get back to the app."
    />
  );
}
