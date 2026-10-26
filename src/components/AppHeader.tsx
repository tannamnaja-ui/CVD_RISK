import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import { routeHref } from '../hooks/useHashRoute';
import { dataMode } from '../services/dataMode';
import { useDirectUser } from './DirectLogin';
import { BellIcon, CompareIcon, HeartPulseIcon, LogoutIcon, UserIcon, UsersIcon } from './Icons';

export function AppHeader({ path, hospitalName }: { path: string; hospitalName: string }) {
  const { userInfo, disconnectSession } = useBmsSessionContext();
  const direct = dataMode() === 'direct';
  const officer = useDirectUser();
  // direct mode: HOSxP officer login; BMS mode: the BMS session user
  const name = direct ? officer?.user.name : userInfo?.name;
  const location = direct ? officer?.user.loginName : userInfo?.location;
  const signOut = direct ? officer?.logout : disconnectSession;

  const nav = [
    { path: '/', label: 'รายการผู้ป่วย', icon: <UsersIcon size={16} /> },
    { path: '/follow-up', label: 'ติดตามผู้ป่วย', icon: <BellIcon size={16} /> },
    { path: '/report', label: 'รายงาน', icon: <CompareIcon size={16} /> },
  ];

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="brand">
          <span className="brand__logo">
            <HeartPulseIcon size={28} />
          </span>
          <div>
            <h1 className="brand__title">CV Risk Calculator</h1>
            <p className="brand__subtitle">
              {hospitalName ? `${hospitalName} · ` : ''}แบบประเมินความเสี่ยงโรคหัวใจและหลอดเลือดระยะ 10 ปี · 6 สูตรมาตรฐาน
            </p>
          </div>
        </div>

        <nav className="app-nav" aria-label="เมนูหลัก">
          {nav.map((n) => (
            <a key={n.path} href={routeHref(n.path)} className={`app-nav__link${path === n.path || (n.path === '/' && path === '/assess') ? ' is-active' : ''}`} aria-current={path === n.path ? 'page' : undefined}>
              {n.icon} {n.label}
            </a>
          ))}
        </nav>

        {(!direct || officer) && (
          <div className="user-chip">
            <span className="user-chip__avatar">
              <UserIcon size={18} />
            </span>
            <span className="user-chip__text">
              <span className="user-chip__name">{name || 'ผู้ใช้งาน'}</span>
              {location && <span className="user-chip__loc">{location}</span>}
            </span>
            <button type="button" className="icon-btn" onClick={signOut} title="ออกจากระบบ" aria-label="ออกจากระบบ">
              <LogoutIcon size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
