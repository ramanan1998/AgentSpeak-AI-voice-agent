import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { titleForPath } from "@/routes/nav";
import { Input } from "@/components/ui/input";
import LogoutButton from "../LogoutButton";

interface TopbarProps {
  backendOk: boolean;
}

export function Topbar({ backendOk }: TopbarProps) {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold tracking-tight">{titleForPath(pathname)}</h1>

      <div className="relative ml-auto hidden w-72 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search…" className="pl-9" />
      </div>

      <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${backendOk ? "bg-success" : "bg-destructive"}`} />
        {backendOk ? "Backend connected" : "Backend offline"}
      </div>

      <LogoutButton/>
    </header>
  );
}
