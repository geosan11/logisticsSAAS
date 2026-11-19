import React, { useState, useEffect } from 'react';
import { CustomerWallet, Transaction } from '../lib/types';
import { fmt, tnow } from '../lib/helpers';
import { Wallet, RefreshCw, ArrowUpRight, ArrowDownLeft, Sparkles, ChevronRight, ChevronLeft, Plus, History, X, Search } from 'lucide-react';

interface LiveCreditFeedProps {
  wallets: CustomerWallet[];
  transactions: Transaction[];
  // Mirrors TransactionLedger.tsx's own (already-debounced) search box so
  // this panel's Wallets/Live Stream tabs narrow down live as the agent
  // types there too, instead of only reacting to this panel's own "Filter"
  // button (which pushes INTO the ledger's search box, not the other way).
  searchQuery?: string;
  onOpenTopUp?: (customerName?: string) => void;
  onOpenWalletsView?: () => void;
  onFilterByCustomer?: (customerName: string) => void;
}

export const LiveCreditFeed: React.FC<LiveCreditFeedProps> = ({
  wallets,
  transactions,
  searchQuery,
  onOpenTopUp,
  onOpenWalletsView,
  onFilterByCustomer,
}) => {
  // Starts collapsed -- most agents working the ledger don't need this
  // panel open by default; it's a click away (ChevronLeft) for whoever does.
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<'wallets' | 'activity'>('wallets');
  const [drawerWallet, setDrawerWallet] = useState<CustomerWallet | null>(null);

  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawerWallet) setDrawerWallet(null);
        else setCollapsed(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapsed, drawerWallet]);

  // Totals stay unfiltered -- "Total Customer Credit Liability" and "Active
  // Wallets" must keep meaning the true company-wide figures regardless of
  // whatever's currently typed in the ledger's search box, matching
  // CustomerWallets.tsx's own independent-of-filters totals convention.
  const totalLiability = wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
  const activeWalletsCount = wallets.filter((w) => (w.balance || 0) > 0).length;

  const searchLower = (searchQuery || '').trim().toLowerCase();
  const displayedWallets = wallets
    .filter((w) => (w.balance || 0) > 0)
    .filter((w) =>
      !searchLower ||
      (w.customer_name || '').toLowerCase().includes(searchLower) ||
      (w.customer_phone || '').includes(searchLower)
    );

  // Extract recent retrieval and wallet deduction activities from transactions
  const walletActivities = transactions
    .filter((t) => (t as any).wallet_id || (t as any).wallet_deduction_amount > 0 || t.mode === 'Wallet' || t.detail?.toUpperCase().includes('RETRIVAL') || t.detail?.toUpperCase().includes('RETRIEVAL') || t.detail?.toUpperCase().includes('REFUND') || (t as any).retrieved)
    .filter((t) =>
      !searchLower ||
      (t.name || '').toLowerCase().includes(searchLower) ||
      (t.awb_tag_number || '').toLowerCase().includes(searchLower) ||
      (t.detail || '').toLowerCase().includes(searchLower)
    )
    .slice(0, 25);

  if (collapsed) {
    // Collapsed feed as a fixed viewport pill so it stays put while the
    // ledger scrolls. Avoids `self-center` inside TransactionLedger's
    // un-clamped h-full row (that re-centered downward as more rows loaded).
    // Uses its own classes -- not `ehi-credit-feed` (that is the expanded
    // side panel below).
    return (
      <div
        className="select-none"
        style={{ position: 'fixed', top: '50%', right: 0, transform: 'translateY(-50%)', zIndex: 20 }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-8 sm:w-9 rounded-l-xl rounded-r-none bg-[var(--color-surface-card)]/95 backdrop-blur-sm border border-r-0 border-[var(--color-border)] shadow-sm flex flex-col items-center py-2.5 sm:py-3 gap-2 transition-colors hover:border-[var(--color-border-strong)] cursor-pointer group focus:outline-none min-h-[44px]"
          title="Expand customer credit feed"
          aria-label="Expand customer credit feed"
        >
          <div className="min-w-[44px] min-h-[44px] flex items-center justify-center -my-2 text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-colors">
            <ChevronLeft size={16} />
          </div>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)] shrink-0" />
          <span
            className="text-[11px] font-sans font-medium text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] whitespace-nowrap transition-colors"
            style={{ writingMode: 'vertical-rl' }}
          >
            Prepaid credit · ₦{fmt(totalLiability)}
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Mobile/Tablet Scrim Backdrop so expanded feed slides over instead of crushing the flex viewport */}
      <div
        className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-40 lg:hidden"
        onClick={() => setCollapsed(true)}
      />
      <div className="ehi-credit-feed fixed inset-y-0 right-0 z-50 w-72 sm:w-80 lg:static lg:z-auto lg:w-64 bg-[var(--color-surface-1)] border-l border-[var(--color-border)] flex flex-col h-full shrink-0 shadow-2xl transition-all">
      {/* Feed Header */}
      <div className="p-3 bg-[var(--color-surface-card)] border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-sans font-semibold text-[var(--color-foreground)] truncate">
              Customer credit &amp; activity
            </div>
            <div className="text-[11px] font-sans text-[var(--color-muted)]">
              Liability: <span className="text-[var(--color-foreground)] font-mono tabular-nums font-semibold">₦{fmt(totalLiability)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenTopUp && (
            <button
              type="button"
              onClick={() => onOpenTopUp()}
              className="min-h-[32px] px-3 bg-white text-black hover:bg-neutral-200 rounded-full font-sans text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              title="Top-up customer credit"
            >
              <Plus size={13} />
              <span>Top-up</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="p-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] rounded-full cursor-pointer transition-colors"
            title="Collapse feed"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface-1)] p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('wallets')}
          className={`flex-1 py-1.5 text-[11px] font-sans font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${activeTab === 'wallets'
              ? 'bg-[var(--color-surface-card)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border)] shadow-sm'
              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
        >
          <Wallet size={12} /> Wallets ({displayedWallets.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={`flex-1 py-1.5 text-[11px] font-sans font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${activeTab === 'activity'
              ? 'bg-[var(--color-surface-card)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border)] shadow-sm'
              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
        >
          <History size={12} /> Activity ({walletActivities.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {activeTab === 'wallets' ? (
          displayedWallets.length > 0 ? (
            displayedWallets.map((w) => (
              <div
                key={w.id}
                onClick={() => setDrawerWallet(w)}
                className="p-2.5 bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-xl space-y-1.5 transition-all group cursor-pointer"
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onFilterByCustomer && onFilterByCustomer(w.customer_name)}
                      className="text-[12px] font-semibold font-sans text-[var(--color-foreground)] hover:underline truncate text-left block cursor-pointer leading-tight"
                    >
                      {w.customer_name}
                    </button>
                    {w.customer_phone && (
                      <div className="text-[10px] font-mono tabular-nums text-[var(--color-muted)] mt-0.5">
                        {w.customer_phone}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-mono tabular-nums font-semibold text-[var(--color-foreground)] leading-tight">
                      ₦{fmt(w.balance)}
                    </div>
                    <div className="text-[10px] font-sans text-[var(--color-muted)]">
                      Credit
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-1.5 border-t border-[var(--color-border)] text-[11px] font-sans">
                  {onOpenTopUp && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenTopUp(w.customer_name); }}
                      className="flex-1 min-h-[36px] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-lg font-medium text-center transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Plus size={12} /> Top-up
                    </button>
                  )}
                  {onFilterByCustomer && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onFilterByCustomer(w.customer_name); }}
                      className="flex-1 min-h-[36px] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-lg font-medium text-center transition-colors cursor-pointer flex items-center justify-center gap-1"
                      title={`Filter ledger by ${w.customer_name}`}
                    >
                      <Search size={12} /> Filter
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-[12px] font-sans text-[var(--color-muted)] space-y-2">
              <Wallet size={24} className="mx-auto text-[var(--color-muted)] opacity-50" />
              <div>{searchLower ? 'No wallets match your search.' : 'No customer credit wallets yet.'}</div>
              {!searchLower && onOpenTopUp && (
                <button
                  type="button"
                  onClick={() => onOpenTopUp()}
                  className="px-4 py-2 bg-white text-black hover:bg-neutral-200 font-semibold rounded-full text-[12px] font-sans cursor-pointer transition-colors"
                >
                  Create first wallet
                </button>
              )}
            </div>
          )
        ) : (
          /* Live Stream Activity Feed */
          walletActivities.length > 0 ? (
            walletActivities.map((tx) => {
              const deductionAmt = (tx as any).wallet_deduction_amount || (tx.mode === 'Wallet' ? tx.amount : 0);
              const isRetrieval = tx.detail?.toUpperCase().includes('RETRIVAL') || tx.detail?.toUpperCase().includes('RETRIEVAL') || tx.detail?.toUpperCase().includes('REFUND') || (tx as any).retrieved;

              return (
                <div
                  key={tx.id}
                  className={`p-2.5 rounded-xl border space-y-1.5 transition-all ${isRetrieval
                      ? 'bg-[rgba(34,197,94,0.06)] border-[rgba(34,197,94,0.2)]'
                      : 'bg-[var(--color-surface-card)] border-[var(--color-border)]'
                    }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-sans">
                    <span className="font-semibold flex items-center gap-1">
                      {isRetrieval ? (
                        <>
                          <ArrowDownLeft size={13} className="text-[var(--color-success)]" />
                          <span className="text-[var(--color-success)]">Retrieval refund</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpRight size={13} className="text-[var(--color-muted)]" />
                          <span className="text-[var(--color-foreground)]">Wallet deduction</span>
                        </>
                      )}
                    </span>
                    <span className="text-[var(--color-muted)] font-mono tabular-nums">{tx.time || tnow()}</span>
                  </div>

                  <div className="text-[12px] font-semibold font-sans text-[var(--color-foreground)] truncate">
                    {tx.name}
                  </div>

                  <div className="text-[11px] font-sans text-[var(--color-muted)] truncate">
                    Waybill: <span className="font-mono tabular-nums">{tx.awb_tag_number || tx.id}</span> · {tx.detail}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border)] text-[11px]">
                    <span className="text-[var(--color-muted)] text-[11px] font-sans">
                      {isRetrieval ? 'Credited to wallet:' : 'Deducted from wallet:'}
                    </span>
                    <span className={`font-mono tabular-nums font-semibold ${isRetrieval ? 'text-[var(--color-success)]' : 'text-[var(--color-foreground)]'}`}>
                      {isRetrieval ? `+₦${fmt(tx.amount)}` : `-₦${fmt(deductionAmt)}`}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-[12px] font-sans text-[var(--color-muted)]">
              {searchLower ? 'No activity matches your search.' : 'No recent wallet activity recorded in this shift.'}
            </div>
          )
        )}
      </div>

      {/* Feed Footer */}
      {onOpenWalletsView && (
        <div className="p-3 bg-[var(--color-surface-card)] border-t border-[var(--color-border)] text-center">
          <button
            type="button"
            onClick={onOpenWalletsView}
            className="w-full min-h-[44px] px-4 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-full border border-[var(--color-border)] transition-colors cursor-pointer"
          >
            Manage all wallets &amp; receipts →
          </button>
        </div>
      )}

      {/* Wallet Mini-Drawer */}
      {drawerWallet && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--color-surface-card)] border-l border-[var(--color-border)]">
          {/* Drawer Header */}
          <div className="p-3 bg-[var(--color-surface-1)] border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold font-sans text-[var(--color-foreground)] truncate">{drawerWallet.customer_name}</div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)]">{drawerWallet.customer_phone || 'No phone'}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <div className="text-[13px] font-semibold font-mono tabular-nums text-[var(--color-foreground)]">₦{fmt(drawerWallet.balance)}</div>
                <div className="text-[10px] font-sans text-[var(--color-muted)]">Credit balance</div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerWallet(null)}
                className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] rounded-full cursor-pointer transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider px-1 pb-1">Recent Transactions</div>
            {transactions
              .filter(t =>
                (t.name || '').toLowerCase() === (drawerWallet.customer_name || '').toLowerCase() ||
                (t as any).wallet_id === drawerWallet.id
              )
              .slice(0, 8)
              .map((t, i) => (
                <div key={i} className="p-2 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-border)] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-bold text-[var(--color-foreground)] truncate">{(t as any).id || 'TX'}</div>
                    <div className="text-[10px] font-mono text-[var(--color-muted)] truncate">{t.detail || t.mode}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono font-bold text-[var(--color-success)]">₦{fmt(t.amount)}</div>
                    <div className="text-[10px] font-mono text-[var(--color-muted)]">{t.mode}</div>
                  </div>
                </div>
              ))}
            {transactions.filter(t =>
              (t.name || '').toLowerCase() === (drawerWallet.customer_name || '').toLowerCase() ||
              (t as any).wallet_id === drawerWallet.id
            ).length === 0 && (
                <div className="py-6 text-center text-[10px] font-mono text-[var(--color-muted)]">No recent activity for this wallet</div>
              )}
          </div>

          {/* Quick Actions */}
          <div className="p-2 border-t border-[var(--color-border)] space-y-1.5 shrink-0">
            {onFilterByCustomer && (
              <button
                type="button"
                onClick={() => {
                  onFilterByCustomer(drawerWallet.customer_name);
                  setDrawerWallet(null);
                }}
                className="w-full h-8 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg text-[10px] font-mono font-bold text-[var(--color-foreground)] hover:border-[var(--color-accent-amber)] hover:text-[var(--color-accent-amber)] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <History size={11} /> Filter Ledger
              </button>
            )}
            {onOpenTopUp && (
              <button
                type="button"
                onClick={() => {
                  onOpenTopUp(drawerWallet.customer_name);
                  setDrawerWallet(null);
                }}
                className="w-full h-8 bg-[var(--color-accent-amber)] text-[var(--color-on-accent)] rounded-lg text-[10px] font-mono font-bold hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Plus size={11} /> Top-Up Wallet
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
};
