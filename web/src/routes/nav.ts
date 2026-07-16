import {
  LayoutDashboard,
  Phone,
  ContactRound,
  Bot,
  Workflow as WorkflowIcon,
  Megaphone,
  ArrowLeftRight,
  type LucideIcon,
  History,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/call", label: "Test your agent", icon: Phone },
  { to: "/call-history", label: "Call History", icon: History },
  { to: "/contacts", label: "Contacts", icon: ContactRound },
  { to: "/agents", label: "Create Agent", icon: Bot },
  { to: "/workflows", label: "Workflows", icon: WorkflowIcon },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/human-transfers", label: "Human Transfers", icon: ArrowLeftRight },
];

export function titleForPath(pathname: string): string {
  // exact match first, then prefix match (deep links)
  const exact = NAV_ITEMS.find((n) => n.to === pathname);
  if (exact) return exact.label;
  const prefix = NAV_ITEMS.filter((n) => n.to !== "/").find((n) => pathname.startsWith(n.to));
  return prefix?.label ?? "Dashboard";
}
