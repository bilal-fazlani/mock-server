import Link from "next/link";
import { ThemeToggle } from "@/app/components/ThemeToggle";

export default function UiLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="z-10 flex items-center gap-6 border-b border-border bg-card px-6 py-3">
        <Link href="/ui" className="text-base font-bold tracking-tight text-foreground hover:no-underline">
          Mock Server
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/ui" className="text-muted-foreground hover:text-foreground hover:no-underline">Profiles</Link>
          <Link href="/ui/global-mocks" className="text-muted-foreground hover:text-foreground hover:no-underline">Global mocks</Link>
          <Link href="/ui/catalog" className="text-muted-foreground hover:text-foreground hover:no-underline">Catalog</Link>
          <Link href="/ui/logs" className="text-muted-foreground hover:text-foreground hover:no-underline">Logs</Link>
          <Link href="/ui/environment" className="text-muted-foreground hover:text-foreground hover:no-underline">Environment</Link>
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1280px] px-6 pt-7 pb-16">{children}</div>
    </>
  );
}
