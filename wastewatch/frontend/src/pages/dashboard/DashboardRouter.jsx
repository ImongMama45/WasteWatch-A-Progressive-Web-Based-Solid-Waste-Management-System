import { useAuth } from "../../context/AuthContext";
import WatcherDashboard from "./WatcherDashboard";
import DriverDashboard from "./DriverDashboard";
import AdminDashboard from "./AdminDashboard";
import CitizenDashboard from "./CitizenDashboard";
import BrgyDashboard from "./BrgyDashboard";

export default function DashboardRouter() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase();

  switch (role) {
    case "watcher":
      return <WatcherDashboard />;
    case "driver":
      return <DriverDashboard />;
    case "admin":
      return <AdminDashboard />;
    case "citizen":
      return <CitizenDashboard />;
    case "barangay_official":
      return <BrgyDashboard />;
    default:
      return <div>Unauthorized</div>;
  }
}