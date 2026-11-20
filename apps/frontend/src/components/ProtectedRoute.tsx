import { Navigate, Outlet } from 'react-router';

type ProtectedRouteProps = {
  children?: React.ReactNode;
  isAllowed: boolean;
  redirectPath: string;
};

const ProtectedRoute = ({
  children,
  isAllowed,
  redirectPath = '/',
}: ProtectedRouteProps) => {
  if (!isAllowed) {
    return <Navigate to={redirectPath} replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
