import { Suspense } from "react";

import SuwaliErrorBoundary from "@root/SuwaliErrorBoundary";

import { PanelLoading } from "@ui-components/layout/LoadingIndicator";

import Fallback from "@layouts/error/Fallback";

const LazyRoute = ({ children }: { children: React.ReactNode }) => {
  return (
    <SuwaliErrorBoundary fallback={<Fallback actions={['backHome', 'contactSupport', 'tryAgain']} />}>
      <Suspense fallback={<PanelLoading appLevel />}>
        {children}
      </Suspense>
    </SuwaliErrorBoundary>
  );
};

export default LazyRoute;
