import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { identityConfigured } from "@/lib/tenant";

/**
 * Sign-in, on a path Clerk owns (`/sign-in`, plus whatever it appends for its
 * own flow). With no Clerk keys this route has nothing to show, so it goes back
 * to the app, which is running in its development or single-workspace mode.
 */
export default async function SignInPage(props: PageProps<"/sign-in/[[...sign-in]]">) {
  if (!identityConfigured()) redirect("/");

  const params = await props.searchParams;
  const raw = params?.redirect_url;

  // Only a same-site path is honoured: `redirect_url` arrives in a query string,
  // and a value that starts with `//host` or `https://…` would let someone use
  // this page to bounce a user off-site after they sign in.
  const returnTo = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl={returnTo}
      />
    </div>
  );
}
