import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Patients from "./pages/Patients";
import PatientDetail from "./pages/PatientDetail";
import Children from "./pages/Children";
import ChildDetail from "./pages/ChildDetail";
import Documents from "./pages/Documents";
import AdminDocuments from "./pages/AdminDocuments";
import AdminTherapists from "./pages/AdminTherapists";
import Assistant from "./pages/Assistant";
import Calendar from "./pages/Calendar";
import FeedbackPage from "./pages/Feedback";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const Shell = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute><AppLayout>{children}</AppLayout></ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<Shell><Dashboard /></Shell>} />
            <Route path="/patients" element={<Shell><Patients /></Shell>} />
            <Route path="/patients/:id" element={<Shell><PatientDetail /></Shell>} />
            <Route path="/children" element={<Shell><Children /></Shell>} />
            <Route path="/children/:id" element={<Shell><ChildDetail /></Shell>} />
            <Route path="/documents" element={<Shell><Documents /></Shell>} />
            <Route path="/admin/documents" element={<Shell><AdminDocuments /></Shell>} />
            <Route path="/admin/therapists" element={<Shell><AdminTherapists /></Shell>} />
            <Route path="/assistant" element={<Shell><Assistant /></Shell>} />
            <Route path="/calendar" element={<Shell><Calendar /></Shell>} />
            <Route path="/feedback" element={<Shell><FeedbackPage /></Shell>} />
            <Route path="/profile" element={<Shell><Profile /></Shell>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
