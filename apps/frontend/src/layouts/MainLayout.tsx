import { Outlet } from 'react-router'

import SuwaliErrorBoundary from '@root/SuwaliErrorBoundary';

import TrialDaysRemainingBanner from '@trial-banners/TrialDaysRemainingBanner';

import Fallback from './error/Fallback';

const MainLayout = () => (
  <SuwaliErrorBoundary fallback={<Fallback actions={['backHome', 'contactSupport', 'tryAgain']} />}>
    <TrialDaysRemainingBanner />
    <Outlet />
  </SuwaliErrorBoundary>
);

export default MainLayout;
