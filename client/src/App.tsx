import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DateRangeProvider } from "./contexts/DateRangeContext";

// Pages
import Dashboard from "./pages/Dashboard";
import AdsPerformance from "./pages/AdsPerformance";
import LeadQuality from "./pages/LeadQuality";
import SalesPerformance from "./pages/SalesPerformance";
import FunnelDiagnosis from "./pages/FunnelDiagnosis";
import Recommendations from "./pages/Recommendations";
import DailySummary from "./pages/DailySummary";
import WeeklyReports from "./pages/WeeklyReports";
import Forecasting from "./pages/Forecasting";
import Leaderboard from "./pages/Leaderboard";
import DataSources from "./pages/DataSources";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ads" component={AdsPerformance} />
      <Route path="/leads" component={LeadQuality} />
      <Route path="/sales" component={SalesPerformance} />
      <Route path="/funnel" component={FunnelDiagnosis} />
      <Route path="/recommendations" component={Recommendations} />
      <Route path="/daily" component={DailySummary} />
      <Route path="/weekly" component={WeeklyReports} />
      <Route path="/forecast" component={Forecasting} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/data-sources" component={DataSources} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <DateRangeProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </DateRangeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
