import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, TrendingUp, Users, Target, GitBranch,
  Lightbulb, Brain, BarChart3, Calendar, Trophy, LogOut,
  PanelLeft, Zap, ChevronRight, Database, Home
} from "lucide-react";
import DateRangePicker from "./DateRangePicker";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

const menuGroups = [
  {
    label: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Executive Dashboard", path: "/" },
    ]
  },
  {
    label: "Performance",
    items: [
      { icon: TrendingUp, label: "Ads Performance", path: "/ads" },
      { icon: Users, label: "Lead Quality", path: "/leads" },
      { icon: Target, label: "Sales Performance", path: "/sales" },
    ]
  },
  {
    label: "Intelligence",
    items: [
      { icon: GitBranch, label: "Funnel Diagnosis", path: "/funnel" },
      { icon: Lightbulb, label: "Recommendations", path: "/recommendations" },
    ]
  },
  {
    label: "Reports",
    items: [
      { icon: Brain, label: "Daily AI Summary", path: "/daily" },
      { icon: BarChart3, label: "Weekly Reports", path: "/weekly" },
      { icon: Calendar, label: "Forecasting", path: "/forecast" },
      { icon: Trophy, label: "Leaderboards", path: "/leaderboard" },
    ]
  },
  {
    label: "Settings",
    items: [
      { icon: Database, label: "Data Sources", path: "/data-sources" },
    ]
  }
];

const allMenuItems = menuGroups.flatMap(g => g.items);

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 380;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background grid-bg">
        <div className="flex flex-col items-center gap-8 p-10 max-w-md w-full">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <span className="text-2xl font-bold tracking-tight gradient-text">Growth OS</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-center text-foreground">
              Sign in to access your dashboard
            </h1>
            <p className="text-sm text-muted-foreground text-center">
              Your complete marketing analytics and sales intelligence platform.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Button
              onClick={() => { window.location.href = getLoginUrl(); }}
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
            >
              Sign in to continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { window.location.href = "/"; }}
                className="flex-1 border-border text-muted-foreground hover:text-foreground gap-2"
              >
                <Home className="h-4 w-4" />
                Return Home
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { window.location.href = "/"; }}
                className="flex-1 border-border text-muted-foreground hover:text-foreground gap-2"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (w: number) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = allMenuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-3 w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <button
                  onClick={() => setLocation("/")}
                  className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity focus:outline-none"
                  title="Go to Dashboard"
                >
                  <div className="h-6 w-6 rounded-md bg-primary/20 flex items-center justify-center shrink-0">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="font-bold tracking-tight text-sm gradient-text truncate">Growth OS</span>
                </button>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2">
            {menuGroups.map((group) => (
              <div key={group.label} className="mb-1">
                {!isCollapsed && (
                  <div className="px-4 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {group.label}
                    </span>
                  </div>
                )}
                <SidebarMenu className="px-2">
                  {group.items.map(item => {
                    const isActive = location === item.path;
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className={`h-9 transition-all font-normal text-sm rounded-lg ${
                            isActive
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                          }`}
                        >
                          <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </div>
            ))}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent/50 transition-colors w-full text-left focus:outline-none group-data-[collapsible=icon]:justify-center">
                  <Avatar className="h-8 w-8 border border-border shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary/20 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-sidebar-foreground">{user?.name || "-"}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {/* Desktop topbar */}
        {!isMobile && (
          <div className="flex border-b border-border h-14 items-center justify-between bg-background/95 px-4 backdrop-blur sticky top-0 z-40">
            <span className="text-sm font-medium text-foreground">{activeMenuItem?.label ?? "Growth OS"}</span>
            <DateRangePicker />
          </div>
        )}
        {isMobile && (
          <div className="flex border-b border-border h-14 items-center justify-between bg-background/95 px-3 backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg" />
              <span className="text-sm font-medium text-foreground">{activeMenuItem?.label ?? "Growth OS"}</span>
            </div>
            <DateRangePicker />
          </div>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </>
  );
}
