import { Routes, Route, Navigate } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth.jsx';
import Layout from './components/Layout.jsx';
import { MetaProvider } from './app/MetaProvider.jsx';
import Login from './pages/Login.jsx';
import DemandGlancePage from './pages/demand-glance/DemandGlancePage.jsx';
import ForecastAnalyticsPage from './pages/forecast/ForecastAnalyticsPage.jsx';
import StockAnalysisPage from './pages/stock-analysis/StockAnalysisPage.jsx';
import BrandAnalyticsPage from './pages/brand-analytics/BrandAnalyticsPage.jsx';
import SalesAnalyticsPage from './pages/sales/SalesAnalyticsPage.jsx';
import SalesExtendedPage from './pages/sales/SalesExtendedPage.jsx';
import BasketPage from './pages/basket/BasketPage.jsx';
import DemandForecastPage from './pages/demand-forecast/DemandForecastPage.jsx';
import StockPlacementPage from './pages/placement/StockPlacementPage.jsx';
import RequestsPage from './pages/requests/RequestsPage.jsx';
import OverviewPage from './pages/overview/OverviewPage.jsx';
import ForecastAccuracyPage from './pages/forecast-accuracy/ForecastAccuracyPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            {/* Inside RequireAuth: /meta is token-gated, so fetching it
                above the auth boundary would just 401 on the login page. */}
            <MetaProvider>
              <Layout />
            </MetaProvider>
          </RequireAuth>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/demand-glance" element={<DemandGlancePage />} />
        <Route path="/forecast" element={<ForecastAnalyticsPage />} />
        <Route path="/stock-analysis" element={<StockAnalysisPage />} />
        <Route path="/brand-analytics" element={<BrandAnalyticsPage />} />
        <Route path="/sales" element={<SalesAnalyticsPage />} />
        <Route path="/sales-extended" element={<SalesExtendedPage />} />
        <Route path="/basket" element={<BasketPage />} />
        <Route path="/demand-forecast" element={<DemandForecastPage />} />
        <Route path="/stock-placement" element={<StockPlacementPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/forecast-accuracy" element={<ForecastAccuracyPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
