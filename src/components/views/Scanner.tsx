import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Html5Qrcode } from 'html5-qrcode';
import {
  QrCode,
  RefreshCw,
  Package,
  ArrowDown,
  ArrowUpRight,
  ArrowDownLeft,
  PackageCheck,
  CheckCircle,
  Bell,
  X,
} from 'lucide-react';
import {
  User,
  ScanMode,
  ScanValidationResult,
  BatchScanItem,
  ScanResultType,
  TrackingEvent,
} from '../../lib/types';
import {
  validateScan,
  logScanEvent,
  fetchCargoByRef,
  fetchWrongDestinationAlerts,
  resolveWrongDestinationAlert,
} from '../../lib/scanLogic';
import {
  formatScanModeLabel,
  getScanModeSublabel,
  getScanActionLabel,
  formatScanResultBadge,
  getScannerDensityClasses,
  truncateConsignee,
  SCANNER_MANUAL_INPUT_PLACEHOLDER,
} from '../../lib/scannerLogic';
import { supabase } from '../../lib/supabase';
import { useConfirm } from '../../lib/ConfirmContext';
import { useDensity } from '../../lib/useDensity';
import { BackButton } from '../BackButton';

import { ArrivalsView } from './ArrivalsView';
import { ProofOfDeliveryForm } from './ProofOfDelivery';

// Standard Web Audio API synthesizer for a subtle, high-pitched electronic confirmation blip
const playBeep = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    // Clean, crisp note at 900Hz sliding slightly to 1100Hz
    oscillator.frequency.setValueAtTime(900, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.05);

    gainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.13);
  } catch (error) {
    console.warn('Audio feedback failed to play:', error);
  }
};

// Play a distinct warning/alarm double pulse for wrong destination alerts
const playWarningBeep = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();

    const playPulse = (time: number, freq: number) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(freq, time);
      gainNode.gain.setValueAtTime(0.0, time);
      gainNode.gain.linearRampToValueAtTime(0.15, time + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    };

    playPulse(audioCtx.currentTime, 180);
    playPulse(audioCtx.currentTime + 0.25, 150);
  } catch (error) {
    console.warn('Audio feedback failed to play:', error);
  }
};

function getBrowserCameraInstructions(): { browser: string; steps: string[] } {
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isMobile = /iPhone|iPad|Android/.test(ua);

  if (isSafari && isMobile) {
    return {
      browser: 'Safari (iOS)',
      steps: [
        'Open the iOS Settings app',
        'Scroll down and tap Safari',
        'Tap Camera → Allow',
        'Return here and tap Try again',
      ],
    };
  }
  if (isSafari) {
    return {
      browser: 'Safari',
      steps: [
        'In the menu bar, go to Safari → Settings',
        'Click the Websites tab',
        'Select Camera on the left',
        "Set this site's permission to Allow",
        'Return here and tap Try again',
      ],
    };
  }
  if (isFirefox) {
    return {
      browser: 'Firefox',
      steps: [
        'Click the camera/lock icon in the address bar',
        'Next to Camera, click the × to clear the block',
        'Reload this page, then tap Start scanner',
      ],
    };
  }
  if (isEdge) {
    return {
      browser: 'Edge',
      steps: [
        'Click the lock icon in the address bar',
        'Click Site permissions → Camera → Allow',
        'Return here and tap Try again',
      ],
    };
  }
  // Chrome (desktop or Android)
  if (isMobile) {
    return {
      browser: 'Chrome (Android)',
      steps: [
        'Tap the lock icon in the address bar',
        'Tap Site settings → Camera → Allow',
        'Return here and tap Try again',
      ],
    };
  }
  return {
    browser: 'Chrome',
    steps: [
      'Click the lock icon in the address bar',
      'Click Site settings → Camera → Allow',
      'Return here and tap Try again',
    ],
  };
}

function CameraPermissionDenied({ onRetry }: { onRetry: () => void }) {
  const { browser, steps } = getBrowserCameraInstructions();

  const handleRetry = async () => {
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (status.state === 'denied') {
        return;
      }
    } catch {
      // Permissions API not supported (Safari) — try starting anyway
    }
    onRetry();
  };

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5 sm:p-6 space-y-4 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 flex items-center justify-center text-[var(--color-error)] shrink-0">
          <QrCode size={18} />
        </div>
        <div>
          <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
            Camera access blocked
          </h3>
          <p className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5">
            {browser} needs permission to use your camera for scanning
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-sans font-medium text-[var(--color-muted)] uppercase tracking-wider">
          Steps to enable:
        </div>
        <ol className="list-decimal pl-5 space-y-1 text-[12px] font-sans text-[var(--color-foreground)]">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={handleRetry}
        className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer shadow-xs"
      >
        Try again
      </button>
    </div>
  );
}

const SCAN_MODE_ICONS: Record<ScanMode, React.ComponentType<{ size?: number; className?: string }>> = {
  DEPART: ArrowUpRight,
  ARRIVE: ArrowDownLeft,
  DELIVER: PackageCheck,
};

export const Scanner = ({
  user,
  transactions,
  showToast,
  initialMode = 'DEPART',
}: {
  user: User;
  transactions: any[];
  showToast?: (opts: any) => void;
  initialMode?: ScanMode;
}) => {
  const confirm = useConfirm();
  const { isCompact } = useDensity();
  const density = getScannerDensityClasses(isCompact);
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [isScanning, setIsScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchScanItem[]>([]);
  const [manualRef, setManualRef] = useState('');
  const scannerRef = useRef<any>(null);
  const processingRef = useRef(false);

  // States for batch queuing
  const [isBatchQueueMode, setIsBatchQueueMode] = useState(false);

  const BATCH_QUEUE_KEY = `ehi_scan_batch_queue_${user.hub_id || user.hub}`;

  const [batchQueue, setBatchQueue] = useState<{
    ref: string;
    name: string;
    result: ScanResultType;
    mode: ScanMode;
    destination?: string;
    time: string;
    kg?: number;
    table?: string;
  }[]>(() => {
    try {
      const saved = localStorage.getItem(BATCH_QUEUE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist batch queue to localStorage whenever it changes
  useEffect(() => {
    try {
      if (batchQueue.length > 0) {
        localStorage.setItem(BATCH_QUEUE_KEY, JSON.stringify(batchQueue));
      } else {
        localStorage.removeItem(BATCH_QUEUE_KEY);
      }
    } catch {
      // localStorage unavailable — queue lives in memory only
    }
  }, [batchQueue, BATCH_QUEUE_KEY]);

  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [showQueueSummary, setShowQueueSummary] = useState(false);
  const [showArrivalsView, setShowArrivalsView] = useState(false);
  const [showWrongDestView, setShowWrongDestView] = useState(false);
  const [wrongDestTab, setWrongDestTab] = useState<'unresolved' | 'resolved'>('unresolved');
  const [wrongDestAlerts, setWrongDestAlerts] = useState<TrackingEvent[]>([]);
  const [wrongDestLoading, setWrongDestLoading] = useState(false);
  const [activePodCapture, setActivePodCapture] = useState<{ ref: string; name: string; resultData: any } | null>(null);

  // Cargo tracking history
  const [showTrackView, setShowTrackView] = useState(false);
  const [trackRef, setTrackRef] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackCargo, setTrackCargo] = useState<any>(null);
  const [trackEvents, setTrackEvents] = useState<any[]>([]);

  // Delivery PIN states
  const [pendingDelivery, setPendingDelivery] = useState<{ ref: string; expectedPin: string | null; resultData: any } | null>(null);
  const [pinInput, setPinInput] = useState('');

  // States for popup
  const [popup, setPopup] = useState<{
    visible: boolean;
    type: ScanResultType;
    mode: ScanMode;
    entryRef: string;
    consignee: string;
    hubName: string;
    message: string;
  }>({
    visible: false,
    type: 'ERROR',
    mode: 'ARRIVE',
    entryRef: '',
    consignee: '',
    hubName: '',
    message: '',
  });
  const popupTimerRef = useRef<any>(null);
  const lastScannedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const currentHub = user.hub;
  const batchSuccess = batchItems.filter(b => b.result.startsWith('SUCCESS')).length;
  const batchAlerts = batchItems.filter(b => !b.result.startsWith('SUCCESS') && b.result !== 'ALREADY_PROCESSED').length;
  const successfulScans = (batchItems.length > 0 ? batchItems : batchQueue)
    .filter(item => item.result === 'SUCCESS_ARRIVE' || item.result === 'SUCCESS_DEPART' || item.result === 'SUCCESS_DELIVER')
    .slice(0, 10);

  const sessionScansCount = batchItems.length > 0 ? batchItems.length : batchQueue.length;
  const sessionSuccessCount = batchItems.length > 0
    ? batchSuccess
    : batchQueue.filter(b => b.result.startsWith('SUCCESS')).length;
  const sessionAlertsCount = batchItems.length > 0
    ? batchAlerts
    : batchQueue.filter(b => !b.result.startsWith('SUCCESS') && b.result !== 'ALREADY_PROCESSED').length;

  const loadWrongDestAlerts = useCallback(async (tab: 'unresolved' | 'resolved') => {
    setWrongDestLoading(true);
    try {
      setWrongDestAlerts(await fetchWrongDestinationAlerts(tab));
    } finally {
      setWrongDestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showWrongDestView) loadWrongDestAlerts(wrongDestTab);
  }, [showWrongDestView, wrongDestTab, loadWrongDestAlerts]);

  const handleResolveAlert = async (alertId: string) => {
    try {
      await resolveWrongDestinationAlert(alertId, user.name);
      setWrongDestAlerts(prev => prev.filter(a => a.id !== alertId));
      if (showToast) showToast({ message: 'Alert marked resolved.', type: 'success' });
    } catch (err) {
      console.error('Resolve alert error:', err);
      if (showToast) showToast({ message: "Couldn't resolve this alert -- check your connection and try again.", type: 'error' });
    }
  };

  const handleTrackLookup = async (ref?: string) => {
    const query = (ref || trackRef).trim().toUpperCase();
    if (isScanning) await stopScanner();
    setTrackRef(query);
    setTrackCargo(null);
    setTrackEvents([]);
    setShowTrackView(true);
    if (!query) { setTrackLoading(false); return; }
    setTrackLoading(true);
    try {
      const [cargo, eventsRes] = await Promise.all([
        fetchCargoByRef(query),
        supabase
          .from('tracking_events')
          .select('*')
          .eq('cargo_ref', query)
          .order('created_at', { ascending: true }),
      ]);
      setTrackCargo(cargo || null);
      setTrackEvents(eventsRes.data || []);
    } catch (err) {
      console.error('Track lookup error:', err);
      if (showToast) showToast({ message: 'Track lookup failed -- check your connection and try again.', type: 'error' });
    } finally {
      setTrackLoading(false);
    }
  };

  const handleConfirmSubmitBatch = async (itemsToSubmit = batchQueue) => {
    if (itemsToSubmit.length === 0) return;
    setSubmittingBatch(true);

    try {
      const outcomes = await Promise.all(
        itemsToSubmit.map(async (item) => {
          try {
            const revalidated = await validateScan(item.ref, item.mode, currentHub, transactions);
            if (
              revalidated.type !== 'SUCCESS_ARRIVE' &&
              revalidated.type !== 'SUCCESS_DEPART' &&
              revalidated.type !== 'SUCCESS_DELIVER'
            ) {
              return { item, ok: false, reason: revalidated.message || `${item.ref} is no longer valid to log as ${item.mode}.` };
            }
            const ref = revalidated.cargo?.ref || item.ref;
            const result = await logScanEvent(ref, item.mode, currentHub, user.name, revalidated.cargo?.destination || item.destination, revalidated.cargo?.table || item.table);
            return { item, ok: result.ok, reason: result.error };
          } catch (err: any) {
            return { item, ok: false, reason: err?.message || 'Unexpected error' };
          }
        })
      );

      const succeeded = outcomes.filter(o => o.ok);
      const failed = outcomes.filter(o => !o.ok);

      // Add only the successfully logged items to the session history
      const newlyLoggedItems: BatchScanItem[] = succeeded
        .map(o => ({ ref: o.item.ref, name: o.item.name, result: o.item.result, time: o.item.time }));

      setBatchItems(prev => [...newlyLoggedItems, ...prev]);

      if (failed.length === 0) {
        if (showToast) showToast({ message: `Batch committed — ${succeeded.length} scans logged.`, type: 'success' });
        setBatchQueue([]);
        localStorage.removeItem(BATCH_QUEUE_KEY);
        setShowQueueSummary(false);
      } else {
        const failedRefs = new Set(failed.map(o => o.item.ref));
        setBatchQueue(prev => prev.filter(item => failedRefs.has(item.ref)));
        if (showToast) {
          showToast({
            message: `${succeeded.length} logged, ${failed.length} failed (${failed[0].reason || 'stale/no longer valid'}) — failed items remain in queue.`,
            type: 'error',
          });
        }
      }
    } catch (error) {
      console.error('Batch submit error:', error);
      if (showToast) showToast({ message: 'Batch submit failed. Please try again.', type: 'error' });
    } finally {
      setSubmittingBatch(false);
    }
  };

  const processCode = useCallback(async (code: string) => {
    const now = Date.now();
    if (lastScannedRef.current.code === code && (now - lastScannedRef.current.time) < 1500) {
      return;
    }
    lastScannedRef.current = { code, time: now };

    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    try {
      const result = await validateScan(code, mode, currentHub, transactions);
      const ref = result.cargo?.ref || code;

      // Clear previous popup timer if any
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);

      let message = result.message || '';

      if (result.type === 'WRONG_DESTINATION') {
        playWarningBeep();
        // Wrong-destination alert must be manually dismissed
        setPopup({
          visible: true,
          type: result.type,
          mode,
          entryRef: result.cargo?.awb || ref,
          consignee: result.cargo?.name || 'Unknown Consignee',
          hubName: currentHub,
          message: result.message || '',
        });
        if (showToast) {
          showToast({
            message: `Alert: Wrong station detected! ${result.message}`,
            type: 'error',
          });
        }
        return;
      } else if (result.type === 'SUCCESS_DELIVER' || result.type === 'SUCCESS_ARRIVE' || result.type === 'SUCCESS_DEPART') {
        playBeep();

        if (result.type === 'SUCCESS_DELIVER') {
          setPendingDelivery({ ref, expectedPin: result.cargo?.pickupPin || null, resultData: result });
          processingRef.current = false;
          setProcessing(false);
          return;
        } else if (result.type === 'SUCCESS_ARRIVE') {
          message = 'Status updated to: Arrived';
        } else if (result.type === 'SUCCESS_DEPART') {
          message = 'Status updated to: In transit';
        }

        if (isBatchQueueMode) {
          let isDuplicate = false;
          setBatchQueue(prev => {
            if (prev.some(item => item.ref === ref && item.mode === mode)) {
              isDuplicate = true;
              return prev;
            }
            return [{
              ref,
              name: result.cargo?.name || ref,
              result: result.type,
              mode,
              destination: result.cargo?.destination,
              time: `${new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`,
              kg: result.cargo?.kg,
              table: result.cargo?.table,
            }, ...prev];
          });

          if (isDuplicate) {
            setPopup({
              visible: true,
              type: 'ALREADY_PROCESSED',
              mode,
              entryRef: ref,
              consignee: result.cargo?.name || 'Unknown Consignee',
              hubName: currentHub,
              message: `${ref} is already in the batch queue for ${mode}`,
            });
            return;
          }
        } else {
          const logResult = await logScanEvent(
            ref,
            mode,
            currentHub,
            user.name,
            result.cargo?.destination,
            result.cargo?.table
          );

          if (!logResult.ok) {
            setPopup({
              visible: true,
              type: 'ERROR',
              mode,
              entryRef: ref,
              consignee: result.cargo?.name || 'Unknown Consignee',
              hubName: currentHub,
              message: logResult.error || 'Failed to record this scan -- please try again.',
            });
            popupTimerRef.current = setTimeout(() => {
              setPopup(prev => ({ ...prev, visible: false }));
            }, 3000);
            return;
          }

          // Add to session batch/history list
          setBatchItems(prev => [{
            ref,
            name: result.cargo?.name || ref,
            result: result.type,
            time: `${new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`,
          }, ...prev]);
        }
      }

      setPopup({
        visible: true,
        type: result.type,
        mode,
        entryRef: result.cargo?.awb || ref,
        consignee: result.cargo?.name || 'Unknown Consignee',
        hubName: currentHub,
        message,
      });

      // Auto dismiss popup after 3 seconds
      popupTimerRef.current = setTimeout(() => {
        setPopup(prev => ({ ...prev, visible: false }));
      }, 3000);

    } catch (err) {
      console.error('Scan processing error:', err);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      setPopup({
        visible: true,
        type: 'ERROR',
        mode,
        entryRef: code,
        consignee: 'Unknown Consignee',
        hubName: currentHub,
        message: 'An unexpected error occurred while processing.',
      });
      popupTimerRef.current = setTimeout(() => {
        setPopup(prev => ({ ...prev, visible: false }));
      }, 2000);
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [mode, currentHub, user.name, isBatchQueueMode, transactions, showToast]);

  const processCodeRef = useRef(processCode);
  useEffect(() => {
    processCodeRef.current = processCode;
  }, [processCode]);

  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Start camera scanner
  const startScanner = useCallback(() => {
    setPermissionDenied(false);
    setIsScanning(true);
  }, []);

  useEffect(() => {
    if (!isScanning || scannerRef.current) return;

    const scanner = new Html5Qrcode('qr-reader-div');
    scannerRef.current = scanner as any;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      (decodedText) => processCodeRef.current(decodedText),
      () => { /* ignore scan errors */ }
    ).catch((err: any) => {
      console.error('Scanner start error:', err);
      scannerRef.current = null;
      setIsScanning(false);

      const name: string = err?.name || (typeof err === 'string' ? err : '');
      let msg = 'Camera failed to start. Tap again to retry.';
      if (name.includes('NotAllowed') || name.includes('PermissionDenied')) {
        setPermissionDenied(true);
        return;
      } else if (name.includes('NotFound') || name.includes('DevicesNotFound')) {
        msg = 'No camera detected on this device.';
      } else if (name.includes('NotReadable') || name.includes('TrackStart') || name.includes('Abort')) {
        msg = 'Camera is busy — another app may be using it. Close it and tap again.';
      } else if (name.includes('NotSupported') || name.includes('OverConstrained')) {
        msg = 'Back camera not available. Try a different browser or device.';
      }

      if (showToastRef.current) {
        showToastRef.current({ message: msg, type: 'error' });
      }
    });
  }, [isScanning]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Acceptable if it throws
      }
      try {
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }

    const videoEls = document.querySelectorAll<HTMLVideoElement>(
      '#qr-reader-div video'
    );
    videoEls.forEach(video => {
      if (video.srcObject instanceof MediaStream) {
        video.srcObject.getTracks().forEach(track => {
          track.stop();
        });
        video.srcObject = null;
      }
      video.load();
    });

    setIsScanning(false);
    setProcessing(false);
    processingRef.current = false;
    setPopup(prev => ({ ...prev, visible: false }));
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
  }, []);

  const dismissAlert = useCallback(async () => {
    processingRef.current = false;
    setPopup(prev => ({ ...prev, visible: false }));
  }, []);

  const switchToArriveAndDismiss = useCallback(() => {
    setMode('ARRIVE');
    dismissAlert();
  }, [dismissAlert]);

  const handleManualLookup = async () => {
    if (!manualRef.trim()) return;
    await processCode(manualRef.trim());
    setManualRef('');
  };

  const handleCommitDelivery = async () => {
    if (!pendingDelivery) return;

    const { ref, resultData } = pendingDelivery;
    const actualPin = pendingDelivery.expectedPin;

    if (actualPin !== null) {
      if (!pinInput || pinInput.trim() === '') {
        if (showToast) showToast({ message: 'Please enter the pickup PIN.', type: 'error' });
        return;
      }
      if (pinInput.trim() !== actualPin) {
        if (showToast) showToast({ message: 'Incorrect PIN — check with the consignee.', type: 'error' });
        return;
      }
    }

    if (isScanning) await stopScanner();

    setActivePodCapture({ ref, name: resultData.cargo?.name || 'Unknown Consignee', resultData });
    setPendingDelivery(null);
    setPinInput('');
  };

  const handlePodComplete = async () => {
    if (!activePodCapture) return;
    const { ref, resultData } = activePodCapture;
    const message = 'Status updated to: Delivered';

    if (isBatchQueueMode) {
      let isDuplicate = false;
      setBatchQueue(prev => {
        if (prev.some(item => item.ref === ref && item.mode === 'DELIVER')) {
          isDuplicate = true;
          return prev;
        }
        return [{
          ref,
          name: resultData.cargo?.name || ref,
          result: resultData.type,
          mode: 'DELIVER',
          destination: resultData.cargo?.destination,
          time: `${new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`,
          kg: resultData.cargo?.kg,
          table: resultData.cargo?.table,
        }, ...prev];
      });

      if (isDuplicate) {
        setPopup({
          visible: true,
          type: 'ALREADY_PROCESSED',
          mode: 'DELIVER',
          entryRef: ref,
          consignee: resultData.cargo?.name || 'Unknown Consignee',
          hubName: currentHub,
          message: `${ref} is already in the batch queue for DELIVER`,
        });
        setActivePodCapture(null);
        return;
      }
    } else {
      const logResult = await logScanEvent(
        ref,
        'DELIVER',
        currentHub,
        user.name,
        resultData.cargo?.destination,
        resultData.cargo?.table
      );

      if (!logResult.ok) {
        setPopup({
          visible: true,
          type: 'ERROR',
          mode: 'DELIVER',
          entryRef: ref,
          consignee: resultData.cargo?.name || 'Unknown Consignee',
          hubName: currentHub,
          message: logResult.error || 'Failed to record this delivery -- please try again.',
        });
        if (showToast) showToast({ message: logResult.error || 'Failed to record this delivery.', type: 'error' });
        setActivePodCapture(null);
        return;
      }

      setBatchItems(prev => [{
        ref,
        name: resultData.cargo?.name || ref,
        result: resultData.type,
        time: `${new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`,
      }, ...prev].slice(0, 50));
    }

    setPopup({
      visible: true,
      type: resultData.type,
      mode: 'DELIVER',
      entryRef: ref,
      consignee: resultData.cargo?.name || 'Unknown Consignee',
      hubName: currentHub,
      message,
    });

    if (showToast) showToast({ message, type: 'success' });

    popupTimerRef.current = setTimeout(() => {
      setPopup(prev => ({ ...prev, visible: false }));
    }, 4000);

    setActivePodCapture(null);
  };

  // Stop scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.stop().catch(() => {});
        } catch { /* ignore */ }
        try { scannerRef.current.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }

      document.querySelectorAll<HTMLVideoElement>(
        '#qr-reader-div video'
      ).forEach(video => {
        if (video.srcObject instanceof MediaStream) {
          video.srcObject.getTracks().forEach(t => t.stop());
          video.srcObject = null;
        }
      });

      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
  }, []);

  // Arrivals List View
  if (showArrivalsView) {
    return <ArrivalsView user={user} onBack={() => setShowArrivalsView(false)} />;
  }

  // Wrong Destination Alert History
  if (showWrongDestView) {
    return (
      <div className="flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] select-none">
        <header className={`sticky top-0 z-20 border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)]/95 backdrop-blur-md ${isCompact ? 'py-2.5' : 'py-3'}`}>
          <div className="flex items-center gap-3">
            <BackButton onClick={() => setShowWrongDestView(false)} />
            <div className="min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
                Wrong destination alerts
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                Shipments scanned at an unexpected hub station
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full pb-28">
          <div className="inline-flex bg-[var(--color-surface-1)] p-1 rounded-full border border-[var(--color-border)]">
            {(['unresolved', 'resolved'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setWrongDestTab(tab)}
                className={`min-h-[44px] h-11 px-5 rounded-full text-[12px] font-sans transition-all cursor-pointer ${
                  wrongDestTab === tab
                    ? 'bg-[var(--color-surface-card)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-xs font-semibold'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                }`}
              >
                {tab === 'unresolved' ? 'Unresolved' : 'Resolved'}
              </button>
            ))}
          </div>

          {wrongDestLoading ? (
            <div className="flex justify-center py-16">
              <RefreshCw size={24} className="animate-spin text-[var(--color-muted)]" />
            </div>
          ) : wrongDestAlerts.length === 0 ? (
            <div className="text-center py-16 text-[12px] font-sans text-[var(--color-muted)] border border-dashed border-[var(--color-border)] rounded-2xl">
              {tabDisplay(wrongDestTab)}
            </div>
          ) : (
            <div className="space-y-3">
              {wrongDestAlerts.map(alert => (
                <div key={alert.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-4 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${alert.resolved ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`} />
                      <span className="font-mono text-[13px] font-semibold text-[var(--color-foreground)] tabular-nums">{alert.cargo_ref}</span>
                    </div>
                    <span className="text-[11px] font-sans text-[var(--color-muted)] tabular-nums">
                      {new Date(alert.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="text-[12px] font-sans text-[var(--color-muted)] grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {alert.previous_hub && (
                      <div>
                        <span className="text-[11px] block">Previous hub</span>
                        <span className="text-[var(--color-foreground)] font-medium">{alert.previous_hub}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-[11px] block">Scanned at</span>
                      <span className="text-[var(--color-error)] font-medium">{alert.hub_name}</span>
                    </div>
                    {alert.cargo_destination && (
                      <div>
                        <span className="text-[11px] block">Belongs at</span>
                        <span className="text-[var(--color-success)] font-medium">{alert.cargo_destination}</span>
                      </div>
                    )}
                  </div>

                  {alert.resolved ? (
                    <div className="text-[11px] font-sans text-[var(--color-success)] pt-1">
                      ✓ Resolved by {alert.resolved_by || 'Unknown'} · {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString('en-NG') : ''}
                    </div>
                  ) : (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handleResolveAlert(alert.id)}
                        className="min-h-[44px] h-11 px-5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] text-[var(--color-foreground)] transition-colors cursor-pointer shadow-xs"
                      >
                        Mark resolved
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tracking history view
  if (showTrackView) {
    return (
      <div className="flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] select-none">
        <header className={`sticky top-0 z-20 border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)]/95 backdrop-blur-md ${isCompact ? 'py-2.5' : 'py-3'}`}>
          <div className="flex items-center gap-3">
            <BackButton onClick={() => setShowTrackView(false)} />
            <div className="min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
                Cargo tracking
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                Timeline and station scan history
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full pb-28">
          {/* Search bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTrackLookup();
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <input
                id="scanner-track-ref"
                name="track-ref"
                type="text"
                value={trackRef}
                onChange={e => setTrackRef(e.target.value.toUpperCase())}
                placeholder="Enter AWB or tag reference..."
                aria-label="Enter AWB or tag reference"
                className="w-full min-h-[44px] h-11 pl-4 pr-9 text-[13px] font-sans rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
              />
              {trackRef && (
                <button
                  type="button"
                  onClick={() => setTrackRef('')}
                  aria-label="Clear tracking reference"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!trackRef.trim() || trackLoading}
              className="min-h-[44px] h-11 px-6 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer shrink-0 disabled:opacity-50 shadow-xs"
            >
              {trackLoading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {trackLoading && (
            <div className="flex justify-center py-16">
              <RefreshCw size={24} className="animate-spin text-[var(--color-muted)]" />
            </div>
          )}

          {!trackLoading && trackRef && !trackCargo && trackEvents.length === 0 && (
            <div className="text-center py-16 text-[12px] font-sans text-[var(--color-muted)] border border-dashed border-[var(--color-border)] rounded-2xl">
              No tracking records found for <span className="font-mono text-[var(--color-foreground)]">{trackRef}</span>
            </div>
          )}

          {/* Cargo info card */}
          {trackCargo && (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-5 space-y-3 shadow-xs">
              <div className="text-[16px] font-sans font-semibold text-[var(--color-foreground)]">
                {trackCargo.consignee_name || trackCargo.passenger_name || trackCargo.customer_name || 'Unknown consignee'}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] font-sans text-[var(--color-muted)]">
                <span>Ref: <strong className="font-mono text-[var(--color-foreground)] tabular-nums">{trackRef}</strong></span>
                {trackCargo.route && <span>Route: <strong className="text-[var(--color-foreground)]">{trackCargo.route}</strong></span>}
                {trackCargo.total_pcs && <span>Pieces: <strong className="text-[var(--color-foreground)] tabular-nums">{trackCargo.total_pcs} pcs</strong></span>}
                {trackCargo.total_kg && <span>Weight: <strong className="text-[var(--color-foreground)] tabular-nums">{trackCargo.total_kg} kg</strong></span>}
                {trackCargo.airline && <span>Carrier: <strong className="text-[var(--color-foreground)]">{trackCargo.airline}</strong></span>}
              </div>
              {trackCargo.status && (
                <div className="pt-1 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${trackCargo.status === 'Delivered' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-info)]'}`} />
                  <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                    Current status: {trackCargo.status}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Event timeline */}
          {trackEvents.length > 0 && (
            <div className="space-y-3">
              <div className="text-[12px] font-sans font-medium text-[var(--color-muted)]">
                Event timeline ({trackEvents.length})
              </div>
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-[var(--color-border)]">
                {trackEvents.map((ev, i) => {
                  const badge = formatScanResultBadge(ev.event_type);
                  return (
                    <div key={ev.id || i} className="relative space-y-1">
                      <span className={`absolute -left-6 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-canvas)] ${
                        badge.tone === 'success' ? 'bg-[var(--color-success)]' : badge.tone === 'info' ? 'bg-[var(--color-info)]' : 'bg-[var(--color-error)]'
                      }`} />
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-3.5 space-y-1 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[11px] font-sans font-semibold ${
                            badge.tone === 'success' ? 'text-[var(--color-success)]' : badge.tone === 'info' ? 'text-[var(--color-info)]' : 'text-[var(--color-error)]'
                          }`}>
                            {badge.label}
                          </span>
                          <span className="text-[11px] font-sans text-[var(--color-muted)] tabular-nums">
                            {new Date(ev.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-[13px] font-sans text-[var(--color-foreground)] font-medium">
                          {ev.hub_name}
                        </div>
                        {ev.scanned_by_name && (
                          <div className="text-[11px] font-sans text-[var(--color-muted)]">
                            Recorded by {ev.scanned_by_name}
                          </div>
                        )}
                        {ev.event_type === 'WRONG_DESTINATION_ALERT' && ev.alert_reason && (
                          <div className="text-[11px] font-sans text-[var(--color-error)] bg-[var(--color-error)]/10 px-2.5 py-1.5 rounded-lg mt-1">
                            {ev.alert_reason}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activePodCapture) {
    return createPortal(
      <div className="fixed inset-0 z-[150] bg-[var(--color-canvas)] flex flex-col">
        <ProofOfDeliveryForm
          awbNumber={activePodCapture.ref}
          consigneeName={activePodCapture.name}
          user={user}
          onComplete={handlePodComplete}
          onCancel={() => setActivePodCapture(null)}
        />
      </div>,
      document.body
    );
  }

  // Batch Queue Summary View
  if (showQueueSummary) {
    return (
      <div className="flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] select-none">
        <header className={`sticky top-0 z-20 border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)]/95 backdrop-blur-md ${isCompact ? 'py-2.5' : 'py-3'}`}>
          <div className="flex items-center gap-3">
            <BackButton onClick={() => setShowQueueSummary(false)} />
            <div className="min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
                Batch queue
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                {batchQueue.length} {batchQueue.length === 1 ? 'item' : 'items'} staged on this device
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full pb-28">
          {batchQueue.length === 0 ? (
            <div className="text-center py-16 text-[12px] font-sans text-[var(--color-muted)] border border-dashed border-[var(--color-border)] rounded-2xl">
              The batch queue is currently empty. Switch to Batch queue mode to stage scans.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Clear batch queue?',
                      message: 'Are you sure you want to clear all items in the batch queue?',
                      confirmLabel: 'Clear queue',
                      tone: 'danger',
                    });
                    if (ok) {
                      setBatchQueue([]);
                      setShowQueueSummary(false);
                      if (showToast) showToast({ message: 'Batch queue cleared', type: 'info' });
                    }
                  }}
                  className="min-h-[44px] h-11 px-4 rounded-full text-[12px] font-sans font-medium text-[var(--color-error)] bg-[var(--color-error)]/10 hover:bg-[var(--color-error)]/20 border border-[var(--color-error)]/30 transition-colors cursor-pointer"
                >
                  Clear queue ({batchQueue.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmSubmitBatch()}
                  disabled={submittingBatch}
                  className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
                >
                  {submittingBatch ? (
                    <>
                      <RefreshCw size={14} className="animate-spin text-black" />
                      <span>Committing…</span>
                    </>
                  ) : (
                    <span>Commit batch ({batchQueue.length})</span>
                  )}
                </button>
              </div>

              <div className="space-y-1.5">
                {batchQueue.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)] transition-all gap-2.5 shadow-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.mode === 'ARRIVE' ? 'bg-[var(--color-success)]' : item.mode === 'DEPART' ? 'bg-[var(--color-info)]' : 'bg-[var(--color-success)]'
                      }`} />
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--color-foreground)] truncate">{item.name}</div>
                        <div className="text-[10px] font-mono text-[var(--color-muted)] flex items-center gap-1.5 tabular-nums">
                          <span>{item.ref}</span>
                          {item.kg && <span>· {item.kg} kg</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] font-sans font-semibold text-[var(--color-foreground)]">
                          {formatScanModeLabel(item.mode)}
                        </div>
                        <div className="text-[9px] text-[var(--color-muted)] tabular-nums font-sans">{item.time}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBatchQueue(prev => prev.filter((_, idx) => idx !== i));
                          if (showToast) showToast({ message: `Removed ${item.ref} from queue`, type: 'info' });
                        }}
                        className="min-h-[44px] h-11 px-3 text-[11px] font-sans text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded-full transition-colors cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] select-none">
      {/* ── 1. Unified Quiet Header Toolbar (Sticky) ────────────────────── */}
      <header className={`sticky top-0 z-20 border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)]/95 backdrop-blur-md ${isCompact ? 'py-2.5' : 'py-3'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
              QR Scanner
            </h1>
            <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
              Active station: <strong className="font-medium text-[var(--color-foreground)]">{currentHub}</strong>
            </p>
          </div>

          {/* Quick Shortcuts Toolbar */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowArrivalsView(true)}
              aria-label="View arrivals"
              className="min-h-[44px] h-11 px-3.5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <ArrowDown size={14} className="text-[var(--color-muted)] shrink-0" />
              <span>Arrivals</span>
            </button>
            <button
              type="button"
              onClick={() => setShowWrongDestView(true)}
              aria-label="View wrong destination alerts"
              className="min-h-[44px] h-11 px-3.5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Bell size={14} className={wrongDestAlerts.some(a => !a.resolved) ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'} />
              <span>Alerts</span>
              {wrongDestAlerts.filter(a => !a.resolved).length > 0 && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-error)] shrink-0" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── 2. Scanner Main Viewport ────────────────────────────────────── */}
      <section aria-label="Scanner workspace" className={`flex-1 ${density.workspace} max-w-4xl mx-auto w-full`} style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        {/* Mode Toggle Segment: Depart / Arrive / Deliver (Primary prominent controls) */}
        <div
          role="tablist"
          aria-label="Scan mode actions"
          className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1.5 rounded-2xl bg-[var(--color-surface-1)] border border-[var(--color-border)] w-full"
        >
          {(['DEPART', 'ARRIVE', 'DELIVER'] as ScanMode[]).map((m) => {
            const active = mode === m;
            const dotColor = m === 'ARRIVE' ? 'bg-[var(--color-success)]' : m === 'DEPART' ? 'bg-[var(--color-info)]' : 'bg-[var(--color-success)]';
            const Icon = SCAN_MODE_ICONS[m];
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={formatScanModeLabel(m)}
                data-mode={m}
                data-selected={active ? 'true' : 'false'}
                onClick={() => { setMode(m); dismissAlert(); }}
                className={`flex-1 min-w-0 ${density.modeButton} rounded-xl transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 sm:gap-1 select-none ${
                  active
                    ? 'bg-black text-white dark:bg-white dark:text-black shadow-md border border-transparent font-semibold'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-transparent hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                  <span className={`w-2 h-2 rounded-full ${active ? dotColor : `${dotColor} opacity-50`} shrink-0`} />
                  <Icon size={19} className={`shrink-0 ${active ? 'text-white dark:text-black' : 'text-[var(--color-muted)]'}`} />
                  <span className="text-[14px] sm:text-[15px] font-sans font-semibold tracking-tight">
                    {formatScanModeLabel(m)}
                  </span>
                </div>
                <span className={`hidden sm:block text-[11px] font-sans truncate max-w-full px-1 ${
                  active ? 'text-white/80 dark:text-black/75 font-medium' : 'text-[var(--color-muted)]'
                }`}>
                  {getScanModeSublabel(m)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scan Log Option: Direct Log vs Batch Queue */}
        <div className="flex items-center justify-center pt-0.5">
          <div className="inline-flex bg-[var(--color-surface-1)] p-1 rounded-full border border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => { setIsBatchQueueMode(false); dismissAlert(); }}
              className={`min-h-[44px] h-11 px-5 rounded-full text-[12px] font-sans transition-all cursor-pointer ${
                !isBatchQueueMode
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-xs font-semibold'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              Direct log
            </button>
            <button
              type="button"
              onClick={() => { setIsBatchQueueMode(true); dismissAlert(); }}
              className={`min-h-[44px] h-11 px-5 rounded-full text-[12px] font-sans transition-all cursor-pointer flex items-center gap-1.5 ${
                isBatchQueueMode
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-xs font-semibold'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              <span>Batch queue</span>
              {batchQueue.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-white text-black font-bold">
                  {batchQueue.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* In batch mode: show the compact secondary batch queue staging card */}
        {isBatchQueueMode && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                  Staged batch queue
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)] tabular-nums">
                  {batchQueue.length} {batchQueue.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <p className="text-[11px] font-sans text-[var(--color-muted)] mt-0.5">
                {batchQueue.length === 0
                  ? 'Queue is empty. Scans in this mode will be staged locally before committing.'
                  : 'Scans are staged locally on this device. Review before committing to the database.'}
              </p>
            </div>
            {batchQueue.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowQueueSummary(true)}
                  className="min-h-[44px] h-11 px-3.5 rounded-full text-[11px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer"
                >
                  Review queue
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmSubmitBatch()}
                  disabled={submittingBatch}
                  className="min-h-[44px] h-11 px-4 rounded-full text-[12px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
                >
                  {submittingBatch ? (
                    <>
                      <RefreshCw size={13} className="animate-spin text-black" />
                      <span>Committing…</span>
                    </>
                  ) : (
                    <span>Commit batch</span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* In direct log mode: compact inline reminder if uncommitted batch items exist */}
        {!isBatchQueueMode && batchQueue.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 flex items-center justify-between gap-2.5 text-[11px] font-sans shadow-xs">
            <span className="text-[var(--color-muted)]">
              <strong className="text-[var(--color-foreground)] font-medium tabular-nums">{batchQueue.length}</strong> uncommitted batch {batchQueue.length === 1 ? 'item' : 'items'} staged
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowQueueSummary(true)}
                className="min-h-[44px] h-11 px-3 rounded-full text-[11px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors cursor-pointer"
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => handleConfirmSubmitBatch()}
                disabled={submittingBatch}
                className="min-h-[44px] h-11 px-3.5 rounded-full bg-white text-black hover:bg-neutral-200 font-semibold text-[11px] cursor-pointer disabled:opacity-50 transition-colors shadow-xs"
              >
                Commit
              </button>
            </div>
          </div>
        )}

        {/* Camera Scanner View */}
        {isScanning ? (
          <div className="relative w-full rounded-2xl overflow-hidden border border-[var(--color-border)] bg-black">
            {/* Mode indicator pill over camera */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-white text-[12px] font-sans">
              <span className={`w-2 h-2 rounded-full ${mode === 'ARRIVE' ? 'bg-[var(--color-success)]' : mode === 'DEPART' ? 'bg-[var(--color-info)]' : 'bg-[var(--color-success)]'}`} />
              <span className="font-medium">{formatScanModeLabel(mode)} mode</span>
              <span className="text-white/60">·</span>
              <span className="text-white/70 text-[11px]">{getScanModeSublabel(mode)}</span>
            </div>
            <div id="qr-reader-div" className="w-full min-h-[300px]" />
            {processing && (
              <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-xs flex items-center justify-center">
                <RefreshCw size={28} className="animate-spin text-white" />
              </div>
            )}
            <div className="p-3 bg-[var(--color-surface-card)] border-t border-[var(--color-border)] flex justify-center">
              <button
                type="button"
                onClick={stopScanner}
                className="min-h-[44px] h-11 px-6 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Stop camera
              </button>
            </div>
          </div>
        ) : permissionDenied ? (
          <CameraPermissionDenied onRetry={startScanner} />
        ) : (
          <div
            onClick={startScanner}
            className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)] transition-all ${density.cameraCard} flex flex-col items-center justify-center cursor-pointer text-center group shadow-xs`}
          >
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] group-hover:border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-foreground)] transition-colors">
              <QrCode size={24} />
            </div>
            <div className="space-y-1">
              <div className="text-[15px] font-sans font-semibold text-[var(--color-foreground)]">
                Start camera scanner
              </div>
              <p className="text-[12px] font-sans text-[var(--color-muted)] max-w-sm">
                Point device camera at cargo QR tag, waybill barcode, or package label
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); startScanner(); }}
              className="mt-1 min-h-[44px] h-11 px-6 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer shadow-xs"
            >
              Start scanner
            </button>
          </div>
        )}

        {/* Manual Reference Lookup Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleManualLookup();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <QrCode size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
            <input
              id="scanner-manual-ref"
              name="manual-ref"
              type="text"
              value={manualRef}
              onChange={e => setManualRef(e.target.value.toUpperCase())}
              placeholder={SCANNER_MANUAL_INPUT_PLACEHOLDER}
              aria-label="Enter waybill or package reference"
              className="w-full min-h-[44px] h-11 pl-10 pr-9 text-[13px] font-sans rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
            />
            {manualRef && (
              <button
                type="button"
                onClick={() => setManualRef('')}
                aria-label="Clear reference"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              disabled={!manualRef.trim() || processing}
              aria-label={getScanActionLabel(mode)}
              className="flex-1 sm:flex-initial min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
            >
              {processing && <RefreshCw size={14} className="animate-spin text-black shrink-0" />}
              <span>{processing ? 'Logging…' : getScanActionLabel(mode)}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (manualRef.trim()) {
                  handleTrackLookup(manualRef.trim());
                } else {
                  setShowTrackView(true);
                }
              }}
              aria-label="Track cargo history"
              className="min-h-[44px] h-11 px-4 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              Track
            </button>
          </div>
        </form>

        {/* Telemetry Counter Chips (compact, secondary stat chips) */}
        {sessionScansCount > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${density.telemetryCard} flex items-center justify-between sm:justify-center sm:gap-2 text-center shadow-xs`}>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0" />
                <span className="text-[10px] sm:text-[11px] font-sans text-[var(--color-muted)]">Logged</span>
              </div>
              <span className="text-[13px] sm:text-[14px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">
                {sessionSuccessCount}
              </span>
            </div>
            <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${density.telemetryCard} flex items-center justify-between sm:justify-center sm:gap-2 text-center shadow-xs`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sessionAlertsCount > 0 ? 'bg-[var(--color-error)]' : 'bg-[var(--color-muted)]'}`} />
                <span className="text-[10px] sm:text-[11px] font-sans text-[var(--color-muted)]">Alerts</span>
              </div>
              <span className={`text-[13px] sm:text-[14px] font-sans font-semibold tabular-nums ${sessionAlertsCount > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
                {sessionAlertsCount}
              </span>
            </div>
            <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${density.telemetryCard} flex items-center justify-between sm:justify-center sm:gap-2 text-center shadow-xs`}>
              <span className="text-[10px] sm:text-[11px] font-sans text-[var(--color-muted)]">Total</span>
              <span className="text-[13px] sm:text-[14px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">
                {sessionScansCount}
              </span>
            </div>
          </div>
        )}

        {/* Recent Scans List Card (compact, secondary order-related UI) */}
        <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${density.recentCard} shadow-xs`}>
          <div className="flex items-center justify-between mb-2 border-b border-[var(--color-border)] pb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-[11px] font-sans font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Recent scans
              </h2>
              <span className="text-[10px] font-sans px-1.5 py-0.5 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-muted)]">
                Last 10
              </span>
            </div>
          </div>

          {successfulScans.length === 0 ? (
            <div className="text-center py-6 text-[11px] font-sans text-[var(--color-muted)]">
              No scans recorded in this session yet
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {successfulScans.map((item, index) => {
                const badge = formatScanResultBadge(item.result);
                const toneClass = badge.tone === 'success'
                  ? 'text-[var(--color-success)] bg-[var(--color-success)]/10'
                  : badge.tone === 'info'
                  ? 'text-[var(--color-info)] bg-[var(--color-info)]/10'
                  : 'text-[var(--color-error)] bg-[var(--color-error)]/10';

                return (
                  <div
                    key={index}
                    onClick={() => handleTrackLookup(item.ref)}
                    title={`View tracking history for ${item.ref}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleTrackLookup(item.ref)}
                    className="flex items-center justify-between py-1.5 px-2 min-h-[44px] text-[12px] gap-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors group focus:outline-none focus:ring-1 focus:ring-[var(--color-border-strong)]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 h-6 rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border)] flex items-center justify-center shrink-0 group-hover:border-[var(--color-border-strong)] transition-colors">
                        <Package size={12} className="text-[var(--color-muted)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--color-foreground)] truncate text-[12px]">
                          {truncateConsignee(item.name, 28)}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--color-muted)] truncate tabular-nums">
                          {item.ref}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 text-[10px] font-sans font-medium rounded-full ${toneClass}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] font-sans text-[var(--color-muted)] tabular-nums">
                        {item.time}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 3. Delivery PIN Verification Modal ──────────────────────────── */}
      {pendingDelivery && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delivery-pin-heading"
          onKeyDown={(e) => e.key === 'Escape' && setPendingDelivery(null)}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCommitDelivery();
            }}
            className="bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border-strong)] p-6 w-full max-w-sm shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200"
          >
            <div className="flex flex-col items-center text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-foreground)]">
                <CheckCircle size={22} className="text-[var(--color-success)]" />
              </div>
              <h2 id="delivery-pin-heading" className="text-[16px] font-sans font-semibold text-[var(--color-foreground)]">
                Delivery verification
              </h2>
              <p className="text-[12px] font-sans text-[var(--color-muted)]">
                Enter the pickup PIN for{' '}
                <strong className="font-mono text-[var(--color-foreground)]">{pendingDelivery.ref}</strong>
              </p>
            </div>

            <input
              id="scanner-pin"
              name="pin"
              type="text"
              inputMode="numeric"
              autoFocus
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              placeholder="PIN"
              aria-label="Delivery pickup PIN"
              className="w-full min-h-[48px] h-12 text-center text-xl tracking-widest font-mono rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
              maxLength={8}
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDelivery(null);
                  setPinInput('');
                }}
                className="flex-1 min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!pinInput.trim()}
                className="flex-1 min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                Confirm delivery
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* ── 4. Scan Result Popups & Alerts ──────────────────────────────── */}
      {/* WRONG_DESTINATION centered alert */}
      {popup.visible && popup.type === 'WRONG_DESTINATION' && createPortal(
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wrong-dest-heading"
          onKeyDown={(e) => e.key === 'Escape' && dismissAlert()}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-[var(--color-surface-card)] rounded-2xl border-2 border-[var(--color-error)] p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-error)]/15 border border-[var(--color-error)]/30 flex items-center justify-center text-[var(--color-error)] shrink-0 font-bold text-lg">
                ⚠
              </div>
              <div className="min-w-0 flex-1">
                <div id="wrong-dest-heading" className="text-[15px] font-sans font-bold text-[var(--color-error)]">
                  Wrong station alert
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5">
                  Scanned at {popup.hubName}
                </div>
              </div>
              <button
                type="button"
                onClick={dismissAlert}
                aria-label="Dismiss alert"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3 space-y-1">
              <div className="font-mono text-[13px] font-semibold text-[var(--color-foreground)]">
                {popup.entryRef}
              </div>
              <div className="text-[12px] font-sans text-[var(--color-muted)] truncate">
                {popup.consignee || 'Unknown Consignee'}
              </div>
            </div>

            {popup.message && (
              <div className="text-[12px] font-sans text-[var(--color-error)] bg-[var(--color-error)]/10 p-3 rounded-xl border border-[var(--color-error)]/20 leading-relaxed">
                {popup.message}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={switchToArriveAndDismiss}
                className="w-full min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Switch to Arrive mode instead
              </button>
              <button
                type="button"
                onClick={dismissAlert}
                className="w-full min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black transition-colors cursor-pointer shadow-xs"
              >
                Dismiss alert
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Standard Scan Notification Banner */}
      {popup.visible && popup.type !== 'WRONG_DESTINATION' && createPortal(
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-50 pointer-events-auto transition-all"
        >
          <div className="rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface-card)] p-4 shadow-xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] flex items-center justify-center shrink-0 mt-0.5">
              {popup.type.startsWith('SUCCESS') ? (
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]" />
              ) : popup.type === 'ALREADY_PROCESSED' ? (
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-error)]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
                  {popup.type.startsWith('SUCCESS')
                    ? (popup.mode === 'ARRIVE' ? 'Cargo arrived' : popup.mode === 'DEPART' ? 'Cargo departed' : 'Cargo delivered')
                    : popup.type === 'ALREADY_PROCESSED'
                    ? 'Already logged'
                    : popup.type === 'NOT_LOGGED_IN'
                    ? 'Arrival needed'
                    : 'Scan error'}
                </span>
                <span className="text-[11px] font-mono text-[var(--color-muted)] truncate">
                  {popup.hubName}
                </span>
              </div>
              <div className="text-[12px] font-mono font-medium text-[var(--color-foreground)] mt-0.5 truncate">
                {popup.entryRef}
              </div>
              {popup.consignee && (
                <div className="text-[11px] font-sans text-[var(--color-muted)] truncate">
                  {popup.consignee}
                </div>
              )}
              {popup.message && (
                <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1">
                  {popup.message}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={dismissAlert}
              aria-label="Close notification"
              className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 rounded-full cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

function tabDisplay(tab: 'unresolved' | 'resolved') {
  return tab === 'unresolved'
    ? 'No unresolved wrong-destination alerts.'
    : 'No resolved alerts yet.';
}
