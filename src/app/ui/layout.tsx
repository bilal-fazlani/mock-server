import Link from "next/link";

export default function UiLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="appHeader">
        <Link href="/ui" className="appName">
          Mock Server
        </Link>
        <nav className="appNav">
          <Link href="/ui">Profiles</Link>
          <Link href="/ui/global-mocks">Global mocks</Link>
          <Link href="/ui/catalog">Catalog</Link>
          <Link href="/ui/logs">Logs</Link>
          <Link href="/ui/environment">Environment</Link>
        </nav>
      </header>
      <div className="appMain">{children}</div>
    </>
  );
}
