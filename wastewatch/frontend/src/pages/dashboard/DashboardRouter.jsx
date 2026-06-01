import { useAuth } from "../../context/AuthContext";
import DashboardLayout from "../../components/DashboardLayout";
import WatcherDashboard from "./WatcherDashboard";
import DriverDashboard from "./DriverDashboard";
import AdminDashboard from "./AdminDashboard";
import CitizenDashboard from "./CitizenDashboard";
import BrgyDashboard from "./BrgyDashboard";
import DumpsiteDashboard from "./DumpsiteDashboard";

export default function DashboardRouter() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase();

  let content;
  switch (role) {
    case "watcher":
      content = <WatcherDashboard />;
      break;
    case "driver":
      content = <DriverDashboard />;
      break;
    case "admin":
      content = <AdminDashboard />;
      break;
    case "citizen":
      content = <CitizenDashboard />;
      break;
    case "brgy_official":
      content = <BrgyDashboard />;
      break;
    case "dumpsite":
      content = <DumpsiteDashboard />;
      break;
    default:
      content = <div>Unauthorized</div>;
  }

  return <DashboardLayout>{content}</DashboardLayout>;
}