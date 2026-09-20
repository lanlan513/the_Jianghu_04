import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Sword, Home, Users, Building2, Map } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: '首页', icon: Home },
  { path: '/swords', label: '名剑谱', icon: Sword },
  { path: '/swordsmen', label: '剑客', icon: Users },
  { path: '/sects', label: '门派', icon: Building2 },
  { path: '/map', label: '舆图', icon: Map },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-ink-100/95 backdrop-blur-sm border-b border-ink-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cinnabar-600 to-gold-500 flex items-center justify-center shadow-brush transform group-hover:rotate-12 transition-transform duration-300">
              <Sword className="w-5 h-5 text-ink-100" />
            </div>
            <span className="font-brush text-2xl text-ink-900 tracking-wider">
              江湖名剑谱
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || 
                (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'relative px-5 py-2 rounded-none transition-all duration-300 group',
                    isActive 
                      ? 'text-cinnabar-600' 
                      : 'text-ink-700 hover:text-ink-900'
                  )}
                >
                  <span className="flex items-center gap-2 font-song">
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </span>
                  <span className={cn(
                    'absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 bg-gradient-to-r from-transparent via-cinnabar-600 to-transparent transition-all duration-300',
                    isActive ? 'w-full opacity-100' : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-100'
                  )} />
                </Link>
              );
            })}
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-ink-700 hover:text-ink-900 transition-colors"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="md:hidden border-t border-ink-200 bg-ink-100">
          <div className="container mx-auto px-4 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || 
                (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 font-song transition-colors',
                    isActive 
                      ? 'text-cinnabar-600 bg-cinnabar-50' 
                      : 'text-ink-700 hover:bg-ink-50'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
