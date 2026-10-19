"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVocabulary } from "@/lib/use-vocabulary";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/signals", label: "Signal feed", icon: "◎" },
  { href: "/outreach", label: "Outreach", icon: "✎" },
  { href: "/analytics", label: "Analytics", icon: "◔" },
  { href: "/export", label: "Export", icon: "⤓" },
  { href: "/integrations", label: "Integrations", icon: "⇄" },
  { href: "/niches", label: "Niche explorer", icon: "◈" },
  { href: "/profile", label: "Profile & niche", icon: "⚙" },
];

export function Nav() {
  const pathname = usePathname();
  const data = useVocabulary();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 md:flex">
      <div className="mb-8 px-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            EX
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">EngineX AI</div>
            <div className="text-[11px] text-slate-500">Signal → brief → outreach</div>
          </div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {LINKS.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-slate-900 font-medium text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="w-4 text-center opacity-80">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}
      </nav>
      {/* The niche is real workspace state, so it belongs in the chrome rather
          than in a hardcoded label: this is what tells a security practice that
          it is looking at security signals. */}
      <div className="mt-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        Niche:{" "}
        <span className="font-medium text-slate-700">
          {data?.niche.label ?? "loading…"}
        </span>
        {data ? ` · ${data.vocabulary.length} signals tracked` : null}
        <Link href="/profile" className="mt-1 block underline">
          Change niche
        </Link>
      </div>
    </aside>
  );
}
