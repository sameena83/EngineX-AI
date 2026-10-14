import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { AccountClient } from "./AccountClient";

export default function AccountPage() {
  return (
    <Suspense fallback={<Spinner label="Loading account…" />}>
      <AccountClient />
    </Suspense>
  );
}
