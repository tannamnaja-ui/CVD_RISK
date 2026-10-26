import { useEffect, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { DbSettingsPage, DirectDbGate } from './components/DbSettings';
import { DirectLoginGate } from './components/DirectLogin';
import { FontSizeWidget } from './components/FontSizeWidget';
import { AssessPage } from './components/patients/AssessPage';
import { FollowUpPage } from './components/patients/FollowUpPage';
import { PatientListPage } from './components/patients/PatientListPage';
import { ReportPage } from './components/report/ReportPage';
import { SessionValidator } from './components/SessionValidator';
import { BmsSessionProvider } from './contexts/BmsSessionContext';
import { useHashRoute } from './hooks/useHashRoute';
import { useHosxp } from './hooks/useHosxp';
import { dataMode, markLaunchedFromHosxp } from './services/dataMode';
import { getSessionFromUrl } from './utils/sessionStorage';

export default function App() {
  // Opened from HOSxP XE (session id in the URL) → BMS session + BMS API.
  // Opened on its own → local direct-database mode: database settings page (until connected) → HOSxP login → app.
  // #/settings always opens the database settings page directly (no login), as in the "approve icd10" project.
  const [mode] = useState(() => {
    if (getSessionFromUrl()) markLaunchedFromHosxp();
    return dataMode();
  });
  const route = useHashRoute();
  return (
    <BmsSessionProvider>
      {mode === 'direct' && route.path === '/settings' ? (
        <div className="auth-screen">
          <DbSettingsPage standalone />
        </div>
      ) : mode === 'bms' ? (
        <SessionValidator>
          <Shell />
        </SessionValidator>
      ) : (
        <DirectDbGate>
          <DirectLoginGate>
            <Shell />
          </DirectLoginGate>
        </DirectDbGate>
      )}
    </BmsSessionProvider>
  );
}

function Shell() {
  const route = useHashRoute();
  const { hospitalName: fetchHospitalName } = useHosxp();
  const [hospitalName, setHospitalName] = useState('');

  useEffect(() => {
    fetchHospitalName()
      .then(setHospitalName)
      .catch(() => {
        // hospital name is cosmetic — never block the page
      });
  }, [fetchHospitalName]);

  // full-height pages keep the table scrolling inside the viewport
  const fill = route.path === '/' || route.path === '/follow-up' || (route.path === '/assess' && !route.params.get('vn'));

  let page;
  switch (route.path) {
    case '/follow-up':
      page = <FollowUpPage />;
      break;
    case '/report':
      page = <ReportPage />;
      break;
    case '/assess': {
      // assessments are recorded per visit, so they must start from a patient in the list (with a VN)
      const vn = route.params.get('vn');
      page = vn ? <AssessPage key={vn} vn={vn} /> : <PatientListPage />;
      break;
    }
    default:
      page = <PatientListPage />;
  }

  return (
    <div className={`app${fill ? ' app--fill' : ''}`}>
      <AppHeader path={route.path} hospitalName={hospitalName} />
      <main className={fill ? 'app__main app__main--fill' : 'container'}>{page}</main>
      {!fill && (
        <footer className="app-footer">
          ผลการประเมินเป็นการคาดการณ์ทางสถิติจากสมการมาตรฐาน ใช้ประกอบการคัดกรองเท่านั้น ไม่สามารถใช้แทนการวินิจฉัยของแพทย์ได้
        </footer>
      )}
      <FontSizeWidget page={route.path} />
    </div>
  );
}
