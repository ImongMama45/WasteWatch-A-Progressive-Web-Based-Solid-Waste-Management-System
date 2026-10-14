import { useState, useEffect, useRef } from 'react';
import api from '../api/client';

export function useBarangayTracker(brgyId, pollInterval = 15000) {
  const [data, setData] = useState({ trucks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const liveRef = useRef(false);

  useEffect(() => {
    let timeoutId;
    let isMounted = true;
    let consecutiveErrors = 0;
    let visibilityListener = null;

    setData({ trucks: [] });
    setLoading(true);

    async function fetchTracker() {
      try {
        const url = brgyId 
          ? `/api/analytics/barangay-tracker/?brgy_id=${brgyId}`
          : '/api/analytics/barangay-tracker/';
          
        const res = await api.get(url);
        if (isMounted) {
          setData(res.data);
          setError(null);
          consecutiveErrors = 0;
          liveRef.current = res.data?.trucks?.some(t => ['en_route', 'extended', 'unloading', 'arrived'].includes(t.state)) || false;
        }
      } catch (err) {
        if (isMounted) {
          setError(err);
          consecutiveErrors++;
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          if (pollInterval > 0) {
            // Backoff on errors, slow down if no active trucks
            let nextPoll = pollInterval;
            if (consecutiveErrors > 0) {
              nextPoll = Math.min(pollInterval * Math.pow(2, consecutiveErrors), 60000);
            } else if (!liveRef.current) {
              nextPoll = 60000;
            }
            
            if (!document.hidden) {
              timeoutId = setTimeout(fetchTracker, nextPoll);
            } else {
              visibilityListener = () => {
                document.removeEventListener('visibilitychange', visibilityListener);
                visibilityListener = null;
                if (isMounted) fetchTracker();
              };
              document.addEventListener('visibilitychange', visibilityListener);
            }
          }
        }
      }
    }

    fetchTracker();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (visibilityListener) {
        document.removeEventListener('visibilitychange', visibilityListener);
      }
    };
  }, [brgyId, pollInterval]);

  return { data, loading, error };
}
