import { NavLink } from "react-router-dom";
import { Radio, ChevronLeft, ChevronRight } from "lucide-react";
import { NAV_ITEMS } from "@/routes/nav";
import { useUI } from "@/store/ui";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggle = useUI((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex h-screen flex-col border-r border-[#EAEAEA] bg-white transition-[width] duration-200",
        collapsed ? "w-[80px]" : "w-[280px]",
      )}
    >
      {/* Logo section */}
      <div className="flex h-20 items-center px-6">
        <div className="flex items-center gap-3 whitespace-nowrap">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#2B66EC] text-white">
            <Radio className="h-5 w-5" />
          </div>
          {!collapsed && (
            <span className="whitespace-nowrap text-[20px] font-bold text-[#2B66EC]">Agent Speak</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 px-4 pt-4", collapsed ? "space-y-3" : "space-y-2")}>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex w-full items-center gap-3 rounded-2xl text-[18px] font-medium leading-none transition-colors",
                collapsed ? "justify-center px-0 py-4" : "px-5 py-4",
                isActive
                  ? "bg-[#2B66EC] text-white"
                  : "text-[#2B66EC] hover:bg-[#2B66EC]/[0.08]",
              )
            }
          >
            <Icon className="h-[22px] w-[22px] shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: Collapse */}
      <div className="px-4 pb-5">
        <button
          onClick={toggle}
          title={collapsed ? "Expand" : "Collapse"}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl text-[18px] font-medium leading-none text-[#2B66EC] transition-colors hover:bg-[#2B66EC]/[0.08]",
            collapsed ? "justify-center px-0 py-4" : "px-5 py-4",
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-[22px] w-[22px] shrink-0" />
          ) : (
            <ChevronLeft className="h-[22px] w-[22px] shrink-0" />
          )}
          {!collapsed && <span className="whitespace-nowrap">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
