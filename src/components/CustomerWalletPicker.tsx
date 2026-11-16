import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { CustomerWallet } from '../lib/types';
import { fmt } from '../lib/helpers';
import { Search, Wallet, Plus, X } from 'lucide-react';

interface CustomerWalletPickerProps {
  wallets: CustomerWallet[];
  selectedWallet: CustomerWallet | null;
  onSelectWallet: (wallet: CustomerWallet | null) => void;
  onOpenCreateModal?: (initialName?: string) => void;
  currentCustomerName?: string;
}

export const CustomerWalletPicker: React.FC<CustomerWalletPickerProps> = ({
  wallets,
  selectedWallet,
  onSelectWallet,
  onOpenCreateModal,
  currentCustomerName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [searchTerm, setSearchTerm] = useState(currentCustomerName);

  const closeModal = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 200);
  };

  const filtered = wallets.filter(
    (w) =>
      w.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (w.customer_phone && w.customer_phone.includes(searchTerm))
  );

  return (
    <>
    <div className="relative w-full">
      {selectedWallet ? (
        <div className="p-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--color-surface-2)] text-[var(--color-foreground)] flex items-center justify-center font-bold shrink-0 border border-[var(--color-border)]">
              <Wallet size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold font-sans text-[var(--color-foreground)] truncate">
                  {selectedWallet.customer_name}
                </span>
                <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/20">
                  Active credit
                </span>
              </div>
              <div className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5">
                Available: <span className="font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(selectedWallet.balance)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="min-h-[44px] h-11 px-3 text-[12px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] bg-[var(--color-surface-2)] rounded-full border border-[var(--color-border)] transition-colors cursor-pointer"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => onSelectWallet(null)}
              className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-error)] rounded-full hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              title="Deselect wallet"
              aria-label="Deselect wallet"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex-1 min-h-[44px] h-11 py-2 px-3.5 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-xl flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Wallet size={15} className="text-[var(--color-muted)] shrink-0" />
              <span className="text-[13px] font-sans text-[var(--color-foreground)] truncate">
                {currentCustomerName ? `Select wallet for "${currentCustomerName}"` : 'Select customer credit wallet'}
              </span>
            </div>
            <span className="text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] text-[var(--color-muted)] shrink-0">
              {wallets.length} active
            </span>
          </button>
          {onOpenCreateModal && (
            <button
              type="button"
              onClick={() => onOpenCreateModal(currentCustomerName)}
              className="min-h-[44px] min-w-[44px] h-11 w-11 flex items-center justify-center bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-xl transition-colors cursor-pointer shrink-0"
              title="Create new credit wallet"
              aria-label="Create new credit wallet"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      )}
    </div>

    {/* Wallet Search Modal / Dropdown Overlay -- portaled to document.body */}
    {isOpen && createPortal(
        <div
          className={`fixed inset-0 z-[9999] ehi-scrim flex items-center justify-center p-4 ${
            isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className={`w-full max-w-md bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
            isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
          }`}>
            {/* Modal Header */}
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="text-[var(--color-muted)]" size={17} />
                <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                  Customer credit wallets
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] w-11 h-11 -mr-2 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] rounded-full cursor-pointer transition-colors"
              >
                <X size={17} />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
                <input
                  type="text"
                  placeholder="Search customer name or phone…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full min-h-[44px] h-11 pl-10 pr-3.5 bg-[var(--color-surface-2)] text-[13px] font-sans text-[var(--color-foreground)] border border-[var(--color-border)] rounded-xl focus:border-[var(--color-border-strong)] outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Wallet List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filtered.length > 0 ? (
                filtered.map((w) => {
                  const isSelected = selectedWallet?.id === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        onSelectWallet(w);
                        setIsOpen(false);
                      }}
                      className={`w-full min-h-[44px] p-3 rounded-xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--color-surface-3)] border-[var(--color-border-strong)]'
                          : 'bg-[var(--color-surface-1)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-[13px] font-semibold font-sans text-[var(--color-foreground)] truncate">
                          {w.customer_name}
                        </div>
                        {w.customer_phone && (
                          <div className="text-[11px] font-sans text-[var(--color-muted)]">
                            {w.customer_phone}
                          </div>
                        )}
                        <div className="text-[10px] font-sans text-[var(--color-muted)] mt-0.5 capitalize">
                          {w.source_type.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-sans font-bold text-[var(--color-foreground)] tabular-nums">
                          ₦{fmt(w.balance)}
                        </div>
                        <div className="text-[10px] font-sans text-[var(--color-success)]">
                          Available
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="py-8 text-center space-y-3">
                  <div className="text-[12px] font-sans text-[var(--color-muted)]">
                    No active credit wallet found for &quot;{searchTerm}&quot;
                  </div>
                  {onOpenCreateModal && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenCreateModal(searchTerm);
                      }}
                      className="min-h-[44px] h-11 px-4 bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[12px] font-sans font-semibold rounded-full shadow-xs cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Plus size={14} /> Create wallet for &quot;{searchTerm || 'Customer'}&quot;
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 bg-[var(--color-surface-card)] border-t border-[var(--color-border)] flex items-center justify-between text-[11px] font-sans text-[var(--color-muted)]">
              <span>{wallets.length} active wallets</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="min-h-[44px] h-11 px-4 bg-[var(--color-surface-2)] text-[var(--color-foreground)] rounded-full border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] font-medium text-[12px] cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
