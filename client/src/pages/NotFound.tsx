import { Button } from "@/components/ui/button";
import { AlertCircle, Home, LayoutDashboard } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950">
      {/* Subtle background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />

      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-md">
        {/* Icon */}
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-red-500/20 rounded-full blur-xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
        </div>

        {/* Text */}
        <p className="text-7xl font-black text-white/10 mb-2 select-none">404</p>
        <h1 className="text-2xl font-bold text-white mb-3">Page Not Found</h1>
        <p className="text-slate-400 mb-10 leading-relaxed">
          The page you are looking for doesn't exist or has been moved.
          Use the buttons below to get back on track.
        </p>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button
            onClick={() => setLocation("/")}
            variant="outline"
            className="border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-white gap-2 px-6"
          >
            <Home className="w-4 h-4" />
            Return Home
          </Button>
          <Button
            onClick={() => setLocation("/")}
            className="bg-violet-600 hover:bg-violet-500 text-white gap-2 px-6"
          >
            <LayoutDashboard className="w-4 h-4" />
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
