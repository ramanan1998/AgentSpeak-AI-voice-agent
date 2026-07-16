import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function LogoutButton() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/login"); }}>
      <LogOut className="h-4 w-4" /> Log out
    </Button>
  );
}