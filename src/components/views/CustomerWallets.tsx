import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { User } from '../../lib/types';
import { fmt, tnow } from '../../lib/helpers';
import { supabase, writeAuditLog, fetchRowsCapped } from '../../lib/supabase';
import {
  applyWalletTransaction,
  requestWalletCashPayout,
  approveWalletCashPayout,
  rejectWalletCashPayout,
  requestWalletTopUp,
  approveWalletTopUp,
  rejectWalletTopUp,
  approveRetrievalRefund,
  rejectRetrievalRefund,
  reverseWalletDeduction,
  RetrievalEntryType,
} from '../../lib/wallet';
import { useToast } from '../../lib/ToastContext';
import { useConfirm } from '../../lib/ConfirmContext';
import { useDensity } from '../../lib/useDensity';
import {
  filterWallets,
  isTransactionCredit,
  getTransactionTypeLabel,
  getSourceTypeLabel,
  canApprovePayoutsRole,
  canForceDeleteRole,
  canDirectTopUpRole,
  getWalletDensityClasses,
  filterWalletTransactions,
  formatWalletResultCount,
  validateTopUpAmount,
  validateCashPayoutAmount,
  getWalletStatusBadge,
  TOP_UP_PRESET_AMOUNTS,
} from '../../lib/walletLogic';
import { BackButton } from '../BackButton';
import { Button } from '../ui';
import { openPdfOrDownload } from '../../lib/helpers';
import {
  Wallet,
  Plus,
  Search,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Printer,
  Trash2,
  Undo2,
  X,
  Loader2,
  AlertCircle,
  HandCoins,
  CheckCircle2,
  XCircle,
  Phone,
  Tag,
  MoreVertical,
  Archive,
} from 'lucide-react';

export interface CustomerWallet {
  id: string;
  hub_id?: string;
  customer_name: string;
  customer_phone?: string;
  opening_balance: number;
  balance: number;
  total_topped_up: number;
  total_used: number;
  source_type: 'airline_retrieval' | 'advance_deposit' | 'refund' | 'manual_credit';
  source_ref?: string;
  source_note?: string;
  status: 'active' | 'exhausted' | 'frozen';
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  hub_id?: string;
  type: 'top_up' | 'deduction' | 'refund' | 'adjustment' | 'cash_payout' | 'retrieval_refund' | 'reversal';
  amount: number;
  balance_before: number;
  balance_after: number;
  cargo_ref?: string;
  cargo_entry_id?: string;
  description?: string;
  logged_by: string;
  created_at: string;
  department?: RetrievalEntryType;
  status?: 'completed' | 'pending' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  reversed_at?: string;
  reversed_by?: string;
  reversal_of?: string;
}

export const CustomerWallets = ({
  user,
  onBack,
  initialCustomerName,
  initialAmount,
  initialRef,
}: {
  user: User;
  onBack?: () => void;
  initialCustomerName?: string;
  initialAmount?: number;
  initialRef?: string;
}) => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { isCompact } = useDensity();
  const density = getWalletDensityClasses(isCompact);

  const [wallets, setWallets] = useState<CustomerWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialCustomerName || '');
  const [walletView, setWalletView] = useState<'active' | 'archived'>('active');

  // Modal states
  const [showTopUpModal, setShowTopUpModal] = useState(Boolean(initialAmount));
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<CustomerWallet | null>(null);
  const [walletHistory, setWalletHistory] = useState<WalletTransaction[]>([]);
  const [walletHistoryCapped, setWalletHistoryCapped] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'credits' | 'debits'>('all');
  const [menuWalletId, setMenuWalletId] = useState<string | null>(null);

  // Top-Up form states
  const [formName, setFormName] = useState(initialCustomerName || '');
  const [formPhone, setFormPhone] = useState('');
  const [formAmount, setFormAmount] = useState(initialAmount ? String(initialAmount) : '');
  const [formSourceType, setFormSourceType] = useState<'airline_retrieval' | 'advance_deposit' | 'refund' | 'manual_credit'>(
    initialRef ? 'airline_retrieval' : 'advance_deposit'
  );
  const [formSourceRef, setFormSourceRef] = useState(initialRef || '');
  const [formNote, setFormNote] = useState('');
  const [formPaymentMode, setFormPaymentMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [savingTopUp, setSavingTopUp] = useState(false);

  const [tableMissing, setTableMissing] = useState(false);
  const [walletsCapped, setWalletsCapped] = useState(false);

  const canApprovePayouts = canApprovePayoutsRole(user.role);
  const canForceDelete = canForceDeleteRole(user.role);
  const [forceDeletingId, setForceDeletingId] = useState<string | null>(null);
  const [reversingTxId, setReversingTxId] = useState<string | null>(null);
  const canTopUp = true;
  const canDirectTopUp = canDirectTopUpRole(user.role);

  // Cash-payout request form
  const [payoutWalletId, setPayoutWalletId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutDepartment, setPayoutDepartment] = useState<RetrievalEntryType>('cargo');
  const [payoutNote, setPayoutNote] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  // Esc-to-close for modals and menus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuWalletId) {
        setMenuWalletId(null);
      } else if (payoutWalletId) {
        if (!savingPayout) setPayoutWalletId(null);
      } else if (showHistoryModal) {
        setShowHistoryModal(false);
      } else if (showTopUpModal) {
        if (!savingTopUp) setShowTopUpModal(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTopUpModal, showHistoryModal, payoutWalletId, savingTopUp, savingPayout, menuWalletId]);

  // Click-away listener to close action menus
  useEffect(() => {
    if (!menuWalletId) return;
    const onDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-wallet-menu]')) {
        setMenuWalletId(null);
      }
    };
    window.addEventListener('click', onDocumentClick);
    return () => window.removeEventListener('click', onDocumentClick);
  }, [menuWalletId]);

  // Pending cash payouts awaiting a second person's approval
  const [pendingPayouts, setPendingPayouts] = useState<WalletTransaction[]>([]);
  const [rejectingPayoutId, setRejectingPayoutId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payoutActionLoading, setPayoutActionLoading] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setTableMissing(false);
    try {
      const buildPage = (from: number, to: number) => {
        let query = supabase
          .from('customer_wallets')
          .select('*')
          .order('updated_at', { ascending: false });

        query = walletView === 'archived'
          ? query.not('archived_at', 'is', null)
          : query.is('archived_at', null);

        return query.range(from, to);
      };

      let fetched: CustomerWallet[];
      let capped: boolean;
      try {
        const result = await fetchRowsCapped<CustomerWallet>(buildPage, 20000);
        fetched = result.rows;
        capped = result.capped;
      } catch (error: any) {
        if (
          error?.message?.includes('customer_wallets') ||
          error?.message?.includes('schema cache') ||
          error?.code === '42P01' ||
          error?.code === 'PGRST301'
        ) {
          setTableMissing(true);
          return;
        }
        throw error;
      }
      setWalletsCapped(capped);

      if (walletView === 'active') {
        const toArchive = fetched.filter((w) => w.status === 'exhausted' && !w.archived_at);
        if (toArchive.length > 0) {
          const archivedAt = new Date().toISOString();
          await supabase
            .from('customer_wallets')
            .update({ archived_at: archivedAt })
            .in('id', toArchive.map((w) => w.id));
          const archivedIds = new Set(toArchive.map((w) => w.id));
          setWallets(fetched.filter((w) => !archivedIds.has(w.id)));
          if (toArchive.length === 1) {
            showToast({
              message: `${toArchive[0].customer_name}'s wallet balance reached ₦0 -- automatically archived (history preserved)`,
              type: 'success',
            });
          } else {
            showToast({
              message: `${toArchive.length} wallets reached ₦0 balance -- automatically archived (history preserved)`,
              type: 'success',
            });
          }
          return;
        }
      }
      setWallets(fetched);
    } catch (err: any) {
      console.error('Error fetching customer wallets:', err);
      showToast({ message: 'Failed to load customer wallets: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [walletView, showToast]);

  const fetchPendingPayouts = useCallback(async () => {
    if (!canApprovePayouts) return;
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .in('type', ['cash_payout', 'top_up', 'retrieval_refund'])
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setPendingPayouts((data as WalletTransaction[]) || []);
    } catch (err: any) {
      console.error('Error fetching pending wallet approvals:', err);
    }
  }, [canApprovePayouts]);

  useEffect(() => {
    fetchPendingPayouts();
  }, [fetchPendingPayouts]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const [totalLiability, setTotalLiability] = useState(0);
  const [liabilityCapped, setLiabilityCapped] = useState(false);
  const fetchTotalLiability = useCallback(async () => {
    try {
      const { rows, capped } = await fetchRowsCapped<{ balance: number }>(
        (from, to) => supabase.from('customer_wallets').select('balance').range(from, to),
        20000,
      );
      setTotalLiability(rows.reduce((acc, w) => acc + (w.balance || 0), 0));
      setLiabilityCapped(capped);
    } catch {
      // table may not exist yet -- fetchWallets() already surfaces that case
    }
  }, []);

  useEffect(() => {
    fetchTotalLiability();
  }, [fetchTotalLiability]);

  useEffect(() => {
    const channel = supabase
      .channel('customer_wallets_management_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, (payload) => {
        const walletId = (payload.new as any)?.wallet_id || (payload.old as any)?.wallet_id;
        if (!walletId) return;
        fetchTotalLiability();
        supabase
          .from('customer_wallets')
          .select('*')
          .eq('id', walletId)
          .single()
          .then(async ({ data }) => {
            if (!data) return;
            if (walletView === 'active' && data.status === 'exhausted' && !data.archived_at) {
              await supabase.from('customer_wallets').update({ archived_at: new Date().toISOString() }).eq('id', walletId);
              setWallets((prev) => prev.filter((w) => w.id !== walletId));
              showToast({
                message: `${data.customer_name}'s wallet balance reached ₦0 -- automatically archived (history preserved)`,
                type: 'success',
              });
              return;
            }
            setWallets((prev) => prev.map((w) => (w.id === walletId ? { ...w, ...data } : w)));
          });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [walletView, showToast, fetchTotalLiability]);

  const filteredWallets = filterWallets(wallets, search);

  const handleOpenHistory = async (wallet: CustomerWallet) => {
    setSelectedWallet(wallet);
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      const { rows, capped } = await fetchRowsCapped<WalletTransaction>(
        (from, to) =>
          supabase
            .from('wallet_transactions')
            .select('*')
            .eq('wallet_id', wallet.id)
            .order('created_at', { ascending: false })
            .range(from, to),
        5000,
      );
      setWalletHistory(rows);
      setWalletHistoryCapped(capped);
    } catch (err: any) {
      showToast({ message: 'Failed to load wallet history: ' + err.message, type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleReverseDeduction = async (tx: WalletTransaction) => {
    if (reversingTxId || !selectedWallet) return;
    const ok = await confirm({
      title: 'Undo this deduction?',
      message: `Refunds ₦${fmt(tx.amount)} to ${selectedWallet.customer_name}'s wallet and puts ${tx.cargo_ref || 'the linked shipment'} back to owing (unpaid Debt). Use Unretrieve / Reopen Debt on the shipment instead if this deduction was a retrieval or a debt payment.`,
      confirmLabel: 'Undo Deduction',
      tone: 'danger',
    });
    if (!ok) return;

    setReversingTxId(tx.id);
    try {
      const result = await reverseWalletDeduction({
        transactionId: tx.id,
        loggedBy: user.name || 'Unknown',
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to undo this deduction.', type: 'error' });
        return;
      }
      writeAuditLog({
        user_id: user.id,
        user_name: user.name || 'Unknown',
        action: 'WALLET_DEDUCTION_REVERSED',
        table_name: 'wallet_transactions',
        record_id: tx.id,
        description: `₦${fmt(tx.amount)} deduction undone for ${selectedWallet.customer_name}'s wallet (${tx.cargo_ref || 'no ref'}) -- refunded, shipment back to Debt`,
        hub: undefined,
        hub_id: tx.hub_id,
        old_values: { amount: tx.amount, reversed_at: null },
        new_values: { reversed_at: tnow(), reversal_txn_id: result.reversalTxnId ?? null },
      }).catch(() => {});
      showToast({ message: `₦${fmt(tx.amount)} refunded to ${selectedWallet.customer_name}'s wallet`, type: 'success' });
      await handleOpenHistory(selectedWallet);
      fetchWallets();
      fetchTotalLiability();
    } finally {
      setReversingTxId(null);
    }
  };

  const handleRemoveWallet = async (wallet: CustomerWallet) => {
    const noHistory = wallet.balance === 0 && wallet.total_topped_up === 0 && wallet.total_used === 0;

    if (noHistory) {
      const ok = await confirm({
        title: 'Delete wallet?',
        message: `Permanently delete ${wallet.customer_name}'s wallet? It has no balance or transaction history, so this cannot be undone.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      const { error } = await supabase.from('customer_wallets').delete().eq('id', wallet.id);
      if (error) {
        showToast({ message: `Failed to delete wallet: ${error.message}`, type: 'error' });
        return;
      }
      setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
      showToast({ message: `${wallet.customer_name}'s wallet deleted`, type: 'success' });
      return;
    }

    if (wallet.balance > 0) {
      showToast({
        message: `Cannot archive ${wallet.customer_name}'s wallet -- it still has a ₦${fmt(wallet.balance)} balance. Pay it out (Cash Payout) or otherwise resolve it to ₦0 first.`,
        type: 'error',
      });
      return;
    }

    const ok = await confirm({
      title: 'Archive wallet?',
      message: `${wallet.customer_name}'s wallet has transaction history, so it can't be permanently deleted. Archiving will hide it from this list but keep its full balance and history intact.`,
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase
      .from('customer_wallets')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', wallet.id);
    if (error) {
      showToast({ message: `Failed to archive wallet: ${error.message}`, type: 'error' });
      return;
    }
    setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
    showToast({ message: `${wallet.customer_name}'s wallet archived`, type: 'success' });
  };

  const handleForceDelete = async (wallet: CustomerWallet) => {
    const ok = await confirm({
      title: 'Force delete this wallet?',
      message: `This PERMANENTLY deletes ${wallet.customer_name}'s wallet, including its entire top-up/deduction history. Any cargo, package, or legacy entry that was ever paid from this wallet will keep its own record but lose its link to it. This cannot be undone.`,
      confirmLabel: 'Force Delete',
      tone: 'danger',
    });
    if (!ok) return;

    setForceDeletingId(wallet.id);
    try {
      const { error } = await supabase.rpc('force_delete_wallet', { p_wallet_id: wallet.id });
      if (error) {
        showToast({ message: `Failed to force-delete wallet: ${error.message}`, type: 'error' });
        return;
      }

      setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
      showToast({ message: `${wallet.customer_name}'s wallet permanently deleted`, type: 'success' });
      writeAuditLog({
        user_id: user.id,
        user_name: user.name,
        action: 'DELETE',
        table_name: 'customer_wallets',
        record_id: wallet.id,
        description: `Force-deleted wallet for ${wallet.customer_name} (balance ₦${fmt(wallet.balance)}, lifetime topped up ₦${fmt(wallet.total_topped_up)}, used ₦${fmt(wallet.total_used)})`,
        hub: user.hub,
        hub_id: user.hub_id,
        old_values: {
          customer_name: wallet.customer_name,
          customer_phone: wallet.customer_phone,
          balance: wallet.balance,
          total_topped_up: wallet.total_topped_up,
          total_used: wallet.total_used,
          archived_at: wallet.archived_at,
        },
      }).catch(() => {});
    } catch (err: any) {
      showToast({ message: `Failed to force-delete wallet: ${err.message}`, type: 'error' });
    } finally {
      setForceDeletingId(null);
    }
  };

  const handleSaveTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (!name) {
      showToast({ message: 'Customer name is required', type: 'error' });
      return;
    }
    const validated = validateTopUpAmount(formAmount);
    if (!validated.valid) {
      showToast({ message: validated.error || 'Please enter a valid top-up amount', type: 'error' });
      return;
    }
    const amt = validated.amount;

    setSavingTopUp(true);
    try {
      const { data: foundOrCreated, error: findErr } = await supabase.rpc('find_or_create_customer_wallet', {
        p_hub_id: user.hub_id,
        p_customer_name: name,
        p_customer_phone: formPhone.trim() || null,
        p_created_by: user.name,
        p_source_type: formSourceType,
        p_source_ref: formSourceRef.trim() || null,
        p_source_note: formNote.trim() || null,
        p_opening_balance: amt,
      });
      if (findErr) throw findErr;
      const foundOrCreatedRow = Array.isArray(foundOrCreated) ? foundOrCreated[0] : foundOrCreated;
      if (!foundOrCreatedRow?.wallet_id) throw new Error('Could not find or create wallet');

      const walletId: string = foundOrCreatedRow.wallet_id;
      const isNewWallet: boolean = foundOrCreatedRow.was_created;

      const result = canDirectTopUp
        ? await applyWalletTransaction({
            walletId,
            type: 'top_up',
            amount: amt,
            cargoRef: formSourceRef.trim() || undefined,
            description: formNote.trim() || `Top-up via ${formSourceType.replace('_', ' ')}`,
            loggedBy: user.name,
            paymentMode: formPaymentMode,
          })
        : await requestWalletTopUp({
            walletId,
            amount: amt,
            requestedBy: user.name,
            paymentMode: formPaymentMode,
            note: formNote.trim() || `Top-up via ${formSourceType.replace('_', ' ')}`,
          });

      if (!result.ok) {
        if (isNewWallet && walletId) {
          await supabase.from('customer_wallets').delete().eq('id', walletId).eq('balance', 0).eq('total_topped_up', 0);
        }
        throw new Error(result.error);
      }

      showToast({
        message: canDirectTopUp
          ? `Successfully topped up ₦${fmt(amt)} for ${name}!`
          : `₦${fmt(amt)} top-up requested for ${name} — awaiting approval`,
        type: 'success',
      });
      setShowTopUpModal(false);
      setFormName('');
      setFormPhone('');
      setFormAmount('');
      setFormSourceRef('');
      setFormNote('');
      setFormPaymentMode('Cash');
      fetchWallets();
      fetchPendingPayouts();
    } catch (err: any) {
      console.error('Wallet top up error:', err);
      showToast({ message: 'Failed to complete top-up: ' + err.message, type: 'error' });
    } finally {
      setSavingTopUp(false);
    }
  };

  const handleRequestPayout = async (wallet: CustomerWallet) => {
    const validated = validateCashPayoutAmount(payoutAmount, wallet.balance);
    if (!validated.valid) {
      showToast({ message: validated.error || 'Enter a valid payout amount', type: 'error' });
      return;
    }
    const amt = validated.amount;
    setSavingPayout(true);
    try {
      const result = await requestWalletCashPayout({
        walletId: wallet.id,
        amount: amt,
        department: payoutDepartment,
        requestedBy: user.name,
        note: payoutNote.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `Cash payout of ₦${fmt(amt)} requested — awaiting approval`, type: 'success' });
      setPayoutWalletId(null);
      setPayoutAmount('');
      setPayoutNote('');
      fetchPendingPayouts();
    } catch (err: any) {
      showToast({ message: 'Failed to request payout: ' + err.message, type: 'error' });
    } finally {
      setSavingPayout(false);
    }
  };

  const approveByType = (type: string) =>
    type === 'top_up' ? approveWalletTopUp : type === 'retrieval_refund' ? approveRetrievalRefund : approveWalletCashPayout;
  const rejectByType = (type: string) =>
    type === 'top_up' ? rejectWalletTopUp : type === 'retrieval_refund' ? rejectRetrievalRefund : rejectWalletCashPayout;

  const handleApprovePayout = async (payout: WalletTransaction) => {
    const label = getTransactionTypeLabel(payout.type);
    if (payout.logged_by === user.name) {
      showToast({ message: `You can't approve a ${label.toLowerCase()} you requested yourself`, type: 'error' });
      return;
    }
    const verb = payout.type === 'cash_payout' ? 'deducted from' : 'credited to';
    const ok = await confirm({
      title: `Approve ${label.toLowerCase()}?`,
      message: `Approve a ₦${fmt(payout.amount)} ${label.toLowerCase()} requested by ${payout.logged_by}? The wallet balance will be ${verb} immediately.`,
      confirmLabel: 'Approve',
      tone: 'default',
    });
    if (!ok) return;
    setPayoutActionLoading(payout.id);
    try {
      const result = await approveByType(payout.type)({ transactionId: payout.id, approvedBy: user.name });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `₦${fmt(payout.amount)} ${label.toLowerCase()} approved`, type: 'success' });
      fetchPendingPayouts();
      fetchWallets();
    } catch (err: any) {
      showToast({ message: 'Failed to approve: ' + err.message, type: 'error' });
    } finally {
      setPayoutActionLoading(null);
    }
  };

  const handleRejectPayout = async (payout: WalletTransaction) => {
    const label = getTransactionTypeLabel(payout.type);
    setPayoutActionLoading(payout.id);
    try {
      const result = await rejectByType(payout.type)({
        transactionId: payout.id,
        rejectedBy: user.name,
        reason: rejectReason.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.error);
      showToast({ message: `${label} rejected`, type: 'success' });
      setRejectingPayoutId(null);
      setRejectReason('');
      fetchPendingPayouts();
    } catch (err: any) {
      showToast({ message: 'Failed to reject: ' + err.message, type: 'error' });
    } finally {
      setPayoutActionLoading(null);
    }
  };

  const printWalletReceipt = (wallet: CustomerWallet, tx?: WalletTransaction) => {
    const html = `
      <html>
        <head>
          <title>Wallet Receipt - ${wallet.customer_name}</title>
          <style>
            body { font-family: monospace; font-size: 12px; margin: 20px; width: 300px; }
            .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .title { font-weight: bold; font-size: 14px; margin-bottom: 4px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
            .total { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; font-weight: bold; font-size: 13px; margin: 10px 0; }
            .footer { text-align: center; font-size: 10px; margin-top: 15px; color: #555; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">HAULWEY</div>
            <div>Customer Credit Wallet Receipt</div>
            <div>${user.hub || 'Cargo Outpost'}</div>
          </div>
          <div class="row"><span>Date:</span> <span>${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div class="row"><span>Customer:</span> <span><b>${wallet.customer_name}</b></span></div>
          ${wallet.customer_phone ? `<div class="row"><span>Phone:</span> <span>${wallet.customer_phone}</span></div>` : ''}
          <div class="row"><span>Logged By:</span> <span>${user.name}</span></div>

          <div class="total">
            <div class="row"><span>Amount Added:</span> <span>₦${fmt(tx ? tx.amount : wallet.opening_balance)}</span></div>
            <div class="row"><span>Current Balance:</span> <span>₦${fmt(wallet.balance)}</span></div>
          </div>

          ${tx?.description ? `<div style="margin-bottom: 6px;"><b>Note:</b> ${tx.description}</div>` : ''}

          <div class="footer">
            Keep this receipt. Present your name at the counter during consignment to use your credit balance.
          </div>
        </body>
      </html>
    `;
    openPdfOrDownload(html, `Wallet_Receipt_${wallet.customer_name.replace(/\s+/g, '_')}.pdf`);
  };

  const activeWalletsCount = wallets.filter((w) => (w.balance || 0) > 0).length;
  const lifetimeToppedUp = wallets.reduce((acc, w) => acc + (w.total_topped_up || 0), 0);

  return (
    <div className={`flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] font-sans select-none ${density.containerPadding}`}>
      {/* Top Header & Toolbar */}
      <header className={`border-b border-[var(--color-border)] ${density.headerSpacing} flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0`}>
        <div className="flex items-center gap-3 min-w-0">
          {onBack && <BackButton onClick={onBack} label="Back" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--color-foreground)] truncate">
                Customer wallets
              </h1>
            </div>
            <p className="text-xs text-[var(--color-muted)] truncate">
              Prepaid customer balances and credit liability
            </p>
          </div>
        </div>

        {canTopUp && (
          <button
            onClick={() => setShowTopUpModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 h-11 min-h-[44px] rounded-full bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)] hover:bg-[var(--color-primary-pill-hover)] text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Top-up wallet</span>
          </button>
        )}
      </header>

      {/* Summary KPI Cards */}
      <section className={`grid grid-cols-1 sm:grid-cols-3 ${density.gridGap}`}>
        <div className={`bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-xs space-y-1 sm:space-y-1.5 ${density.cardPadding}`}>
          <div className="text-xs font-medium text-[var(--color-muted)]">
            Total credit liability
          </div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums tracking-tight text-[var(--color-foreground)]">
            ₦{fmt(totalLiability)}
          </div>
          <div className="text-xs text-[var(--color-muted)] truncate">
            {liabilityCapped || walletsCapped
              ? 'Count exceeds display limit · Total may be partial'
              : 'Prepaid customer funds held'}
          </div>
        </div>

        <div className={`bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-xs space-y-1 sm:space-y-1.5 ${density.cardPadding}`}>
          <div className="text-xs font-medium text-[var(--color-muted)]">
            Active wallets
          </div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums tracking-tight text-[var(--color-foreground)]">
            {activeWalletsCount} <span className="text-sm font-normal text-[var(--color-muted)]">customers</span>
          </div>
          <div className="text-xs text-[var(--color-muted)] truncate">
            Available for immediate deduction
          </div>
        </div>

        <div className={`bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] shadow-xs space-y-1 sm:space-y-1.5 ${density.cardPadding}`}>
          <div className="text-xs font-medium text-[var(--color-muted)]">
            Lifetime topped up
          </div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums tracking-tight text-[var(--color-foreground)]">
            ₦{fmt(lifetimeToppedUp)}
          </div>
          <div className="text-xs text-[var(--color-muted)] truncate">
            Cumulative advance deposits
          </div>
        </div>
      </section>

      {/* Maker-checker Pending Wallet Approvals */}
      {canApprovePayouts && pendingPayouts.length > 0 && (
        <section className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-warning)]" />
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                Pending approvals
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-warning)]/15 text-[var(--color-warning)] border border-[var(--color-warning)]/20">
                {pendingPayouts.length}
              </span>
            </div>
            <span className="text-xs text-[var(--color-muted)] hidden sm:inline">
              Maker-checker dual approval required
            </span>
          </div>

          <div className="space-y-2.5">
            {pendingPayouts.map((payout) => {
              const wallet = wallets.find((w) => w.id === payout.wallet_id);
              const isSelf = payout.logged_by === user.name;
              const busy = payoutActionLoading === payout.id;
              const typeLabel = getTransactionTypeLabel(payout.type);

              return (
                <div
                  key={payout.id}
                  className="p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[var(--color-foreground)] truncate" title={wallet?.customer_name}>
                          {wallet?.customer_name || 'Customer account'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]">
                          {typeLabel}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--color-muted)]">
                        Requested by {payout.logged_by}
                        {payout.department ? ` · ${payout.department}` : ''}
                        {payout.description ? ` · ${payout.description}` : ''}
                      </div>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <div className="text-base font-semibold tabular-nums text-[var(--color-foreground)]">
                        ₦{fmt(payout.amount)}
                      </div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {new Date(payout.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  {rejectingPayoutId === payout.id ? (
                    <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason for rejecting (optional)..."
                        className="w-full h-11 min-h-[44px] px-3.5 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl text-sm font-sans text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRejectPayout(payout)}
                          disabled={busy}
                          className="flex-1 h-11 min-h-[44px] rounded-xl text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                        >
                          Confirm rejection
                        </button>
                        <button
                          onClick={() => {
                            setRejectingPayoutId(null);
                            setRejectReason('');
                          }}
                          className="flex-1 h-11 min-h-[44px] rounded-xl text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                      <button
                        onClick={() => handleApprovePayout(payout)}
                        disabled={isSelf || busy}
                        title={isSelf ? "You cannot approve your own request" : 'Approve'}
                        className="flex-1 h-11 min-h-[44px] rounded-xl text-xs font-medium bg-[var(--color-surface-card)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <CheckCircle2 size={15} className="text-[var(--color-success)]" />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => setRejectingPayoutId(payout.id)}
                        disabled={busy}
                        className="flex-1 h-11 min-h-[44px] rounded-xl text-xs font-medium bg-[var(--color-surface-card)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-error)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <XCircle size={15} />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}

                  {isSelf && (
                    <div className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-2)] px-3 py-2 rounded-lg border border-[var(--color-border)] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)] shrink-0" />
                      <span>You submitted this request. A different supervisor or accountant must approve it.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Unified Toolbar: Active/Archived Selector & Search */}
      <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Segmented active/archived selector & result count */}
        <div className="flex items-center justify-between sm:justify-start gap-3 flex-wrap">
          <div className="inline-flex items-center p-1 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl shrink-0">
            <button
              onClick={() => setWalletView('active')}
              className={`min-h-[44px] h-11 px-4 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                walletView === 'active'
                  ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              <span>Active</span>
              <span className="text-[11px] text-[var(--color-muted)]">
                ({wallets.length})
              </span>
            </button>
            <button
              onClick={() => setWalletView('archived')}
              className={`min-h-[44px] h-11 px-4 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                walletView === 'archived'
                  ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] shadow-xs'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              <span>Archived</span>
            </button>
          </div>
          <span className="text-xs text-[var(--color-muted)]">
            {formatWalletResultCount(filteredWallets.length, wallets.length, Boolean(search.trim()))}
          </span>
        </div>

        {/* Search input with 44px tap targets */}
        <div className="relative flex-1 max-w-full sm:max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer or phone..."
            className="w-full h-11 min-h-[44px] pl-10 pr-12 text-sm font-sans rounded-xl bg-[var(--color-surface-card)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-full cursor-pointer"
              title="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </section>

      {/* Database Setup Banner */}
      {tableMissing && (
        <section className="p-4 sm:p-5 bg-[var(--color-surface-card)] border border-[var(--color-warning)]/30 rounded-2xl space-y-3.5 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                Database setup required
              </h2>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                The <code className="text-[var(--color-foreground)] bg-[var(--color-surface-1)] px-1.5 py-0.5 rounded text-xs">customer_wallets</code> table has not been initialized on your database.
              </p>
            </div>
          </div>
          <div className="text-xs text-[var(--color-muted)] leading-relaxed space-y-1.5 bg-[var(--color-surface-1)] p-3.5 rounded-xl border border-[var(--color-border)]">
            <div>1. Open your <b>Supabase Dashboard</b> → <b>SQL Editor</b></div>
            <div>2. Run migration: <code className="text-[var(--color-foreground)] font-medium">supabase/migrations/20260717_cargo_workflow_overhaul.sql</code></div>
            <div>3. Click "Run", then refresh this screen.</div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => {
                const sql = `CREATE TABLE IF NOT EXISTS customer_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID REFERENCES hubs(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_topped_up NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  source_note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES customer_wallets(id),
  hub_id UUID REFERENCES hubs(id),
  type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_before NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  cargo_ref TEXT,
  description TEXT,
  logged_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to customer_wallets" ON customer_wallets;
CREATE POLICY "Allow full access to customer_wallets" ON customer_wallets FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow full access to wallet_transactions" ON wallet_transactions;
CREATE POLICY "Allow full access to wallet_transactions" ON wallet_transactions FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE cargo_entries ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES customer_wallets(id);
ALTER TABLE cargo_entries ADD COLUMN IF NOT EXISTS wallet_deduction_amount NUMERIC(12,2);

ALTER TABLE cargo_entries DROP CONSTRAINT IF EXISTS cargo_entries_receipt_mode_check;
ALTER TABLE cargo_entries ADD CONSTRAINT cargo_entries_receipt_mode_check CHECK (receipt_mode IN ('Cash', 'Transfer', 'TransferCash', 'POS', 'Debt', 'Wallet', 'Complementary'));`;
                navigator.clipboard.writeText(sql);
                showToast({ message: 'Migration SQL copied to clipboard', type: 'success' });
              }}
              className="min-h-[44px] h-11 px-4 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] text-xs font-medium rounded-xl cursor-pointer transition-colors"
            >
              Copy SQL migration query
            </button>
            <button
              onClick={fetchWallets}
              className="min-h-[44px] h-11 px-4 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] text-xs font-medium rounded-xl cursor-pointer transition-colors"
            >
              Retry connection
            </button>
          </div>
        </section>
      )}

      {/* Customer Wallets List */}
      <section className="space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-2 text-[var(--color-muted)]">
            <Loader2 size={24} className="animate-spin text-[var(--color-foreground)]" />
            <span className="text-xs font-sans">Loading customer wallets...</span>
          </div>
        ) : filteredWallets.length === 0 ? (
          <div className="p-8 sm:p-12 text-center bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] text-[var(--color-muted)] space-y-3 shadow-xs">
            <Wallet size={36} className="mx-auto text-[var(--color-muted)]/40" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
                No customer wallets found
              </h3>
              <p className="text-xs text-[var(--color-muted)] max-w-sm mx-auto">
                {search
                  ? `No wallets matching "${search}". Clear the search query to see all accounts.`
                  : walletView === 'archived'
                  ? 'No archived wallets on record.'
                  : 'No customer wallets created yet. Top up a customer to create their first balance.'}
              </p>
            </div>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="inline-flex items-center gap-1.5 px-4 h-11 min-h-[44px] rounded-xl text-xs font-medium bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Clear search filter
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWallets.map((wallet) => {
              const sourceLabel = getSourceTypeLabel(wallet.source_type);
              const isMenuOpen = menuWalletId === wallet.id;
              const statusBadge = getWalletStatusBadge(wallet.status, wallet.balance);

              return (
                <div
                  key={wallet.id}
                  className={`bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]/30 transition-all shadow-xs space-y-3 ${density.itemPadding}`}
                >
                  {/* Top row: Customer Name + Status on left; Available Balance on right */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                      <span
                        className="font-semibold text-base sm:text-lg text-[var(--color-foreground)] truncate"
                        title={wallet.customer_name}
                      >
                        {wallet.customer_name}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)]">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotClass} shrink-0`} />
                        <span>{statusBadge.label}</span>
                      </span>
                    </div>

                    <div className="flex items-baseline sm:items-end justify-between sm:justify-end gap-2 shrink-0">
                      <span className="text-xs text-[var(--color-muted)] sm:hidden">
                        Available balance:
                      </span>
                      <div className="text-right">
                        <div className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--color-foreground)]">
                          ₦{fmt(wallet.balance)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Middle row: Metadata tags & Lifetime breakdown */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--color-muted)] border-t border-[var(--color-border)] pt-2.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      {wallet.customer_phone && (
                        <a
                          href={`tel:${wallet.customer_phone}`}
                          className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)] transition-colors"
                        >
                          <Phone size={12} className="text-[var(--color-muted)]" />
                          <span>{wallet.customer_phone}</span>
                        </a>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Tag size={12} className="text-[var(--color-muted)]" />
                        <span>Source: {sourceLabel}</span>
                      </span>
                      {wallet.source_ref && (
                        <span className="font-mono text-[11px] text-[var(--color-foreground)] bg-[var(--color-surface-1)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
                          {wallet.source_ref}
                        </span>
                      )}
                      <span>
                        Updated {new Date(wallet.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>

                    <div className="text-[11px] tabular-nums text-[var(--color-muted)]">
                      Topped up ₦{fmt(wallet.total_topped_up)} · Used ₦{fmt(wallet.total_used)}
                    </div>
                  </div>

                  {/* Action row: Routine operations + More actions overflow menu */}
                  <div className="pt-2 border-t border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                      {canTopUp && (
                        <button
                          onClick={() => {
                            setFormName(wallet.customer_name);
                            setFormPhone(wallet.customer_phone || '');
                            setShowTopUpModal(true);
                          }}
                          className="h-11 min-h-[44px] px-3.5 rounded-xl text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                          title="Top up wallet balance"
                        >
                          <Plus size={14} strokeWidth={2.5} />
                          <span>Top-up</span>
                        </button>
                      )}

                      {wallet.balance > 0 && (
                        <button
                          onClick={() => {
                            setPayoutWalletId(wallet.id);
                            setPayoutAmount('');
                            setPayoutNote('');
                          }}
                          className="h-11 min-h-[44px] px-3.5 rounded-xl text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                          title="Request cash payout out of wallet balance"
                        >
                          <HandCoins size={14} />
                          <span>Pay cash</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenHistory(wallet)}
                        className="flex-1 sm:flex-initial h-11 min-h-[44px] px-3.5 rounded-xl text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        title="View transaction audit trail"
                      >
                        <History size={14} />
                        <span>History</span>
                      </button>

                      <button
                        onClick={() => printWalletReceipt(wallet)}
                        className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                        title="Print wallet statement receipt"
                      >
                        <Printer size={15} />
                      </button>

                      <div className="flex items-center relative shrink-0" data-wallet-menu>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuWalletId(isMenuOpen ? null : wallet.id);
                          }}
                          aria-expanded={isMenuOpen}
                          aria-haspopup="menu"
                          className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl border border-[var(--color-border)] inline-flex items-center justify-center cursor-pointer transition-colors ${
                            isMenuOpen
                              ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)]'
                              : 'bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                          }`}
                          title="More actions"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {/* Accessible dropdown menu for administrative actions */}
                        {isMenuOpen && (
                          <div
                            className="absolute right-0 bottom-full mb-2 z-40 w-52 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl shadow-xl py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                            style={{ boxShadow: 'var(--shadow-modal)' }}
                            role="menu"
                          >
                            <button
                              onClick={() => {
                                setMenuWalletId(null);
                                handleRemoveWallet(wallet);
                              }}
                              className="w-full min-h-[44px] px-3.5 text-left text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] flex items-center gap-2 cursor-pointer transition-colors"
                              role="menuitem"
                            >
                              <Archive size={14} className="text-[var(--color-muted)]" />
                              <span>{wallet.balance === 0 && wallet.total_topped_up === 0 ? 'Delete empty wallet' : 'Archive account'}</span>
                            </button>

                            {canForceDelete && (
                              <>
                                <div className="h-px bg-[var(--color-border)] my-1" />
                                <button
                                  onClick={() => {
                                    setMenuWalletId(null);
                                    handleForceDelete(wallet);
                                  }}
                                  disabled={forceDeletingId === wallet.id}
                                  className="w-full min-h-[44px] px-3.5 text-left text-xs font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/10 flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors"
                                  role="menuitem"
                                >
                                  <Trash2 size={14} />
                                  <span>Force delete (Purge)</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal: Top-Up / Create Wallet (Portalled to document.body) */}
      {showTopUpModal &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col p-5 sm:p-6 shadow-xl"
              style={{ boxShadow: 'var(--shadow-modal)' }}
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5 shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                    Top-up customer credit wallet
                  </h3>
                  <p className="text-xs text-[var(--color-muted)]">
                    Add advance funds or retrieval credits
                  </p>
                </div>
                <button
                  onClick={() => setShowTopUpModal(false)}
                  className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center justify-center cursor-pointer transition-colors"
                  title="Close (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveTopUp} className="flex-1 overflow-y-auto pr-1 space-y-4 pt-3.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                    Customer name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dangote Group Logistics"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full h-11 min-h-[44px] px-3.5 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                    Phone number (optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 08031234567"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full h-11 min-h-[44px] px-3.5 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-[var(--color-muted)]">
                      Top-up amount (₦) *
                    </label>
                    <span className="text-[11px] text-[var(--color-muted)]">
                      Quick presets:
                    </span>
                  </div>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="e.g. 50000"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full h-11 min-h-[44px] px-3.5 text-base font-semibold tabular-nums rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                  />
                  {/* Touchscreen quick preset buttons for Panasonic CF-31 (44px min touch target) */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                    {TOP_UP_PRESET_AMOUNTS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setFormAmount(String(preset))}
                        className={`h-11 min-h-[44px] px-2 rounded-xl text-xs tabular-nums font-medium transition-colors cursor-pointer border flex items-center justify-center ${
                          formAmount === String(preset)
                            ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-xs'
                            : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        ₦{fmt(preset)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                      Source type
                    </label>
                    <select
                      value={formSourceType}
                      onChange={(e: any) => setFormSourceType(e.target.value)}
                      className="w-full h-11 min-h-[44px] px-3 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                    >
                      <option value="advance_deposit">Advance deposit</option>
                      <option value="airline_retrieval">Airline retrieval</option>
                      <option value="refund">Overcharge refund</option>
                      <option value="manual_credit">Manual credit</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                      Source reference (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. AWB-12345"
                      value={formSourceRef}
                      onChange={(e) => setFormSourceRef(e.target.value)}
                      className="w-full h-11 min-h-[44px] px-3.5 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                      Payment method *
                    </label>
                    <select
                      value={formPaymentMode}
                      onChange={(e: any) => setFormPaymentMode(e.target.value)}
                      className="w-full h-11 min-h-[44px] px-3 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Transfer">Bank transfer</option>
                      <option value="POS">POS card</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--color-muted)] mb-1.5">
                      Note / remarks (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Retained balance"
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      className="w-full h-11 min-h-[44px] px-3.5 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[var(--color-border)]">
                  <button
                    type="button"
                    onClick={() => setShowTopUpModal(false)}
                    className="h-11 min-h-[44px] px-4 rounded-xl text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingTopUp}
                    className="h-11 min-h-[44px] px-5 rounded-full bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)] hover:bg-[var(--color-primary-pill-hover)] text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer transition-colors inline-flex items-center gap-1.5"
                  >
                    {savingTopUp ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Confirming...</span>
                      </>
                    ) : (
                      <span>Confirm top-up</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Modal: History Audit Trail (Portalled to document.body) */}
      {showHistoryModal &&
        selectedWallet &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div
              className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-xl overflow-hidden max-h-[85vh] flex flex-col p-5 sm:p-6 shadow-xl"
              style={{ boxShadow: 'var(--shadow-modal)' }}
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5 shrink-0">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[var(--color-foreground)] truncate" title={selectedWallet.customer_name}>
                    {selectedWallet.customer_name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span>Audit trail</span>
                    <span>·</span>
                    <span className="tabular-nums font-medium text-[var(--color-foreground)]">
                      Balance: ₦{fmt(selectedWallet.balance)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center justify-center cursor-pointer transition-colors"
                  title="Close (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              {/* History filter tabs with 44px tap targets */}
              <div className="flex items-center justify-between gap-2 pt-2 shrink-0">
                <div className="inline-flex items-center p-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl w-full sm:w-auto">
                  <button
                    onClick={() => setHistoryFilter('all')}
                    className={`flex-1 sm:flex-initial min-h-[44px] h-11 px-4 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                      historyFilter === 'all'
                        ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span>All</span>
                    <span className="text-[11px] text-[var(--color-muted)]">({walletHistory.length})</span>
                  </button>
                  <button
                    onClick={() => setHistoryFilter('credits')}
                    className={`flex-1 sm:flex-initial min-h-[44px] h-11 px-4 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                      historyFilter === 'credits'
                        ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    Credits
                  </button>
                  <button
                    onClick={() => setHistoryFilter('debits')}
                    className={`flex-1 sm:flex-initial min-h-[44px] h-11 px-4 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                      historyFilter === 'debits'
                        ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] shadow-xs'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    Debits
                  </button>
                </div>
              </div>

              {walletHistoryCapped && (
                <div className="text-xs text-[var(--color-muted)] shrink-0 bg-[var(--color-surface-1)] p-2.5 rounded-lg border border-[var(--color-border)] mt-2">
                  Showing the most recent 5,000 entries. Older records exist in archive.
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pt-2">
                {historyLoading ? (
                  <div className="p-8 text-center text-[var(--color-muted)] space-y-2">
                    <Loader2 size={24} className="animate-spin mx-auto text-[var(--color-foreground)]" />
                    <span className="text-xs font-sans">Fetching transaction history...</span>
                  </div>
                ) : filterWalletTransactions(walletHistory, historyFilter).length === 0 ? (
                  <div className="p-8 text-center text-[var(--color-muted)] text-xs">
                    {walletHistory.length === 0
                      ? 'No transaction entries found for this wallet.'
                      : `No ${historyFilter} transactions found.`}
                  </div>
                ) : (
                  filterWalletTransactions(walletHistory, historyFilter).map((tx) => {
                    const isCredit = isTransactionCredit(tx.type);
                    const typeLabel = getTransactionTypeLabel(tx.type);
                    const canUndo =
                      tx.type === 'deduction' &&
                      !tx.reversed_at &&
                      tx.status === 'completed' &&
                      canApprovePayouts &&
                      !tx.cargo_entry_id &&
                      !(tx.description || '').startsWith('Retrieval reversal') &&
                      tx.description !== 'Debt settled from wallet';

                    return (
                      <div
                        key={tx.id}
                        className="p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                tx.status === 'rejected'
                                  ? 'text-[var(--color-muted)] line-through'
                                  : tx.status === 'pending'
                                  ? 'text-[var(--color-warning)]'
                                  : isCredit
                                  ? 'text-[var(--color-success)]'
                                  : 'text-[var(--color-error)]'
                              }`}
                            >
                              {isCredit ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                              <span>{typeLabel}</span>
                              {tx.status === 'pending' && ' (Pending)'}
                              {tx.status === 'rejected' && ' (Rejected)'}
                              {tx.reversed_at && ' (Reversed)'}
                            </span>
                            <span className="text-[var(--color-muted)] font-normal">
                              · {new Date(tx.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          </div>

                          <div className="text-xs text-[var(--color-muted)]">
                            {tx.description || tx.cargo_ref || 'Direct counter transaction'}
                          </div>

                          <div className="text-xs text-[var(--color-muted)] flex items-center gap-2 flex-wrap">
                            <span>Logged by {tx.logged_by}</span>
                            {tx.department && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] uppercase">
                                {tx.department}
                              </span>
                            )}
                          </div>

                          {tx.type === 'deduction' && tx.reversed_at && (
                            <div className="text-xs text-[var(--color-muted)] italic">
                              Reversed {new Date(tx.reversed_at).toLocaleDateString('en-GB')}
                              {tx.reversed_by ? ` · ${tx.reversed_by}` : ''}
                            </div>
                          )}

                          {canUndo && (
                            <button
                              onClick={() => handleReverseDeduction(tx)}
                              disabled={reversingTxId === tx.id}
                              className="mt-2 min-h-[44px] h-11 px-3.5 inline-flex items-center justify-center gap-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-error)] rounded-xl transition-colors border border-[var(--color-border)] text-xs font-medium disabled:opacity-50 cursor-pointer"
                              title="Refund this deduction and revert shipment back to debt"
                            >
                              {reversingTxId === tx.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                              <span>Undo deduction</span>
                            </button>
                          )}
                        </div>

                        <div className="text-right shrink-0 space-y-0.5">
                          <div
                            className={`font-semibold tabular-nums text-sm ${
                              ((tx.type === 'top_up' || tx.type === 'retrieval_refund') && tx.status !== 'completed') ||
                              (tx.type === 'cash_payout' && tx.status !== 'completed') ||
                              tx.reversed_at
                                ? 'text-[var(--color-muted)] line-through'
                                : isCredit
                                ? 'text-[var(--color-success)]'
                                : 'text-[var(--color-error)]'
                            }`}
                          >
                            {isCredit ? '+' : '-'}₦{fmt(tx.amount)}
                          </div>
                          <div className="text-[11px] tabular-nums text-[var(--color-muted)]">
                            {tx.status === 'pending' ? 'Pending confirmation' : `Bal after: ₦${fmt(tx.balance_after)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal: Request Cash Payout (Portalled to document.body) */}
      {payoutWalletId &&
        (() => {
          const wallet = wallets.find((w) => w.id === payoutWalletId);
          if (!wallet) return null;

          return createPortal(
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm overflow-hidden max-h-[90vh] flex flex-col p-5 sm:p-6 shadow-xl"
                style={{ boxShadow: 'var(--shadow-modal)' }}
              >
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5 shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-[var(--color-foreground)]">
                      Pay cash out
                    </h3>
                    <p className="text-xs text-[var(--color-muted)] truncate" title={wallet.customer_name}>
                      {wallet.customer_name} · Bal ₦{fmt(wallet.balance)}
                    </p>
                  </div>
                  <button
                    onClick={() => setPayoutWalletId(null)}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center justify-center cursor-pointer transition-colors"
                    title="Close (Esc)"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-4 pt-3.5">
                  <div className="text-xs text-[var(--color-muted)] leading-relaxed bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-3">
                    This creates an approval request. A supervisor or accountant must confirm the payout before funds are disbursed.
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-[var(--color-muted)]">
                          Amount ₦ (max ₦{fmt(wallet.balance)}) *
                        </label>
                        <button
                          type="button"
                          onClick={() => setPayoutAmount(String(wallet.balance))}
                          className="min-h-[36px] h-9 px-3 rounded-lg text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] transition-colors cursor-pointer flex items-center gap-1"
                          title="Set full available balance"
                        >
                          Pay full ₦{fmt(wallet.balance)}
                        </button>
                      </div>
                      <input
                        type="number"
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(e.target.value)}
                        placeholder={String(wallet.balance)}
                        max={wallet.balance}
                        min="1"
                        className="w-full h-11 min-h-[44px] px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-base font-semibold tabular-nums text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[var(--color-muted)] block mb-1.5">
                        Department (record-keeping)
                      </label>
                      <select
                        value={payoutDepartment}
                        onChange={(e) => setPayoutDepartment(e.target.value as RetrievalEntryType)}
                        className="w-full h-11 min-h-[44px] px-3 text-sm font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                      >
                        <option value="cargo">Cargo</option>
                        <option value="package">Package</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-[var(--color-muted)] block mb-1.5">
                        Note / remarks (optional)
                      </label>
                      <input
                        type="text"
                        value={payoutNote}
                        onChange={(e) => setPayoutNote(e.target.value)}
                        placeholder="Why cash is being paid out..."
                        className="w-full h-11 min-h-[44px] px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-sm font-sans text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[var(--color-border)]">
                    <button
                      type="button"
                      onClick={() => setPayoutWalletId(null)}
                      className="h-11 min-h-[44px] px-4 rounded-xl text-xs font-medium bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-foreground)] cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingPayout}
                      onClick={() => handleRequestPayout(wallet)}
                      className="h-11 min-h-[44px] px-5 rounded-full bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)] hover:bg-[var(--color-primary-pill-hover)] text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer transition-colors inline-flex items-center gap-1.5"
                    >
                      {savingPayout ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Requesting...</span>
                        </>
                      ) : (
                        <>
                          <HandCoins size={15} />
                          <span>Request cash payout</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          );
        })()}
    </div>
  );
};
