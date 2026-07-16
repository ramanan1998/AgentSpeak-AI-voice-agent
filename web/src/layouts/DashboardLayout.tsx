import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { useUI } from "@/store/ui";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";

export function DashboardLayout() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  // lightweight backend health ping (also confirms the API base is reachable)
  const { error } = usePolling(() => api.analytics(), 10000);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className={cn("flex min-h-screen flex-col transition-[padding] duration-200", collapsed ? "pl-[80px]" : "pl-[280px]")}>
        <Topbar backendOk={!error} />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
