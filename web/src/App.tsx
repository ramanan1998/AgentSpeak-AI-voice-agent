import { createHashRouter, RouterProvider } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Call from "@/pages/Call";
import Contacts from "@/pages/Contacts";
import CreateAgent from "@/pages/CreateAgent";
import Workflows from "@/pages/Workflows";
import Campaigns from "@/pages/Campaigns";
import CampaignDetails from "@/pages/CampaignDetails";
import CampaignContactDetails from "@/pages/CampaignContactDetails";
import HumanTransfers from "@/pages/HumanTransfers";
import { AuthProvider } from "./hooks/useAuth";
import TestHistoryPage from "./pages/TestHistory";
import TestSessionDetailsPage from "./pages/TestSessionDetails";

// Hash routing: the browser only ever requests "/" from the server, so client routes
// (e.g. #/contacts) never collide with the same-named REST API paths (/contacts, ...).
const router = createHashRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "call", element: <Call /> },
          { path: "call-history", element: <TestHistoryPage /> },
          { path: "call-history/:id", element: <TestSessionDetailsPage /> },
          { path: "contacts", element: <Contacts /> },
          { path: "agents", element: <CreateAgent /> },
          { path: "workflows", element: <Workflows /> },
          { path: "campaigns", element: <Campaigns /> },
          { path: "campaigns/:id", element: <CampaignDetails /> },
          { path: "campaigns/:id/contact/:contactId", element: <CampaignContactDetails /> },
          { path: "human-transfers", element: <HumanTransfers /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  );
}