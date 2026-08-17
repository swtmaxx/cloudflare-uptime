import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin';
import { PublicPageView } from './public';
import './styles.css';

const path = window.location.pathname;
const publicMatch = path.match(/^\/status\/([^/]+)$/);
const publicHome = path === '/';

createRoot(document.getElementById('root')!).render(publicMatch || publicHome
  ? <PublicPageView slug={publicMatch ? decodeURIComponent(publicMatch[1]) : null} />
  : <AdminApp />);
