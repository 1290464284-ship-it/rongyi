import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface AnimatedRouteProps {
  children: React.ReactNode;
}

export function AnimatedRoute({ children }: AnimatedRouteProps) {
  const location = useLocation();
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 200);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div
      className={`transition-opacity duration-200 ease-in-out ${isAnimating ? 'opacity-0' : 'opacity-100'}`}
    >
      {children}
    </div>
  );
}