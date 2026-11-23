import { createRoot } from 'react-dom/client';
import './notfound.css';

function NotFound() {
  return (
    <main>
      <div className="sw"><span>Super</span><span>Water</span></div>
      <p>We couldn't find that page.</p>
      <a href="/">Back to Super Water</a>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<NotFound />);
