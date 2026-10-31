import { Navigate, Route, Routes } from 'react-router'
import {
  CandidateRoute,
  ConnectionRoute,
  EnrollmentRoute,
  LoginRoute,
  RootRoute,
  StartupRoute,
  startupPageEnabled,
} from '@/app/entry/route-components'
import {
  ForbiddenPage,
  NotFoundPage,
  ServerErrorPage,
  ServiceUnavailablePage,
} from '@/app/error-pages'
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      {startupPageEnabled ? <Route path="/startup" element={<StartupRoute />} /> : null}
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/app/enroll" element={<EnrollmentRoute />} />
      <Route path="/app/settings/connection" element={<ConnectionRoute />} />
      <Route path="/owner/manage" element={<Navigate to="/app/settings/connection" replace />} />
      <Route path="/app/manage" element={<Navigate to="/app/settings/connection" replace />} />
      <Route path="/app/*" element={<CandidateRoute />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      <Route path="/503" element={<ServiceUnavailablePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
