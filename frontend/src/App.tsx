import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import Layout from "./components/Layout";
import AnnotatorDashboard from "./pages/AnnotatorDashboard";
import ReviewerDashboard from "./pages/ReviewerDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TaskDetailPage from "./pages/TaskDetailPage";
import JobWorkspace from "./pages/JobWorkspace";
import GoldenEditor from "./pages/GoldenEditor";
import ReviewStage2 from "./pages/ReviewStage2";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center">Đang tải...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "reviewer") return <Navigate to="/reviewer" replace />;
  return <Navigate to="/annotator" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/annotator" element={<AnnotatorDashboard />} />
        <Route path="/reviewer" element={<ReviewerDashboard />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="/jobs/:jobId" element={<JobWorkspace />} />
        <Route path="/jobs/:jobId/review-s2" element={<ReviewStage2 />} />
        <Route path="/golden/:imageId" element={<GoldenEditor />} />
      </Route>
    </Routes>
  );
}
