import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { identityConfigured } from "@/lib/tenant";

/**
 * Sign-up. A new user is not pointed at an existing workspace: the tenant is
 * created on their first authenticated request (see ./src/lib/tenant.ts,
 * `ensureUserTenant`), seeded with the sample market so the app is never empty.
 */
export default async function SignUpPage(props: PageProps<"/sign-up/[[...sign-up]]">) {
  if (!identityConfigured()) redirect("/");

  const params = await props.searchParams;
  const raw = params?.redirect_url;
  const returnTo = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl={returnTo}
      />
    </div>
  );
}
