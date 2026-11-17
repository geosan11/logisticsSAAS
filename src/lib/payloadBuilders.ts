import { Transaction, User } from './types';

export function buildCargoPayload(
  tx: Transaction,
  hubId: string,
  user: Pick<User, 'id'>
): Record<string, any> {
  const parts = tx.is_debt_clearance ? [] : tx.detail.split(' · ');
  const pcsStr = parts[1] || '';
  const kgStr = parts[2] || '';
  const route = parts[3] || '';
  const content = parts[4] || '';

  return {
    id: tx.id,
    entry_ref: tx.id,
    consignee_name: tx.name,
    route: (tx as any).route || route,
    total_pcs: (tx as any).pieces != null ? (tx as any).pieces : (parseInt(pcsStr) || 1),
    total_kg: (tx as any).kg != null ? Math.round((tx as any).kg) : (Math.round(parseFloat(kgStr) || 0)),
    size_inches: tx.sizeInches ?? null,
    content_type: (tx as any).contentType ?? content,
    awb_tag_number: (tx as any).awb_tag_number || '',
    amount: tx.amount,
    receipt_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
    bank: tx.bank,
    hub_id: hubId,
    airline: (tx as any).airline || parts[0] || 'Unknown',
    flight_number: (tx as any).flight || null,
    commission_rate: (tx as any).commissionRate ?? null,
    remark: (tx as any).remarks || null,
    pickup_pin: (tx as any).pickupPin || null,
    consignee_phone: tx.consigneePhone || null,
    client_type: tx.clientType || null,
    created_shift_id: tx.created_shift_id || null,
    corporate_client_id: (tx as any).corporate_client_id || null,
    applied_rate_per_kg: tx.applied_rate_per_kg ?? null,
    linked_as_office_work: (tx as any).linked_as_office_work ?? false,
    wallet_id: tx.wallet_id ?? null,
    wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
    entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
    is_debt_clearance: tx.is_debt_clearance ?? false,
    related_tx_id: tx.related_tx_id ?? null,
    created_at: tx.created_at || new Date().toISOString()
  };
}

export function buildPackagePayload(
  tx: Transaction,
  hubId: string,
  user: Pick<User, 'id' | 'hub'>
): Record<string, any> {
  return {
    id: tx.id,
    entry_ref: tx.id,
    customer_name: tx.name,
    destination: tx.destination || '',
    content_type: (tx as any).contentType || 'Package',
    total_pcs: tx.pieces || 1,
    total_kg: tx.kg || 0,
    contents: (tx as any).contents || null,
    vehicle_plate: tx.vehiclePlate || null,
    driver_name: tx.driverName || null,
    status: tx.status || 'Intake',
    amount: tx.amount,
    payment_mode: tx.mode === 'Debt Paid' ? 'Debt' : tx.mode,
    bank: tx.bank,
    payment_narration: tx.paymentNarration,
    debt_paid: (tx as any).debtPaid ?? false,
    debt_paid_at: (tx as any).debtPaidAt || null,
    amount_paid: tx.amountPaid,
    payment_history: tx.paymentHistory,
    client_type: tx.clientType || null,
    created_shift_id: tx.created_shift_id || null,
    corporate_client_id: (tx as any).corporate_client_id || null,
    applied_rate_per_kg: tx.applied_rate_per_kg ?? null,
    linked_as_office_work: (tx as any).linked_as_office_work ?? false,
    wallet_id: tx.wallet_id ?? null,
    wallet_deduction_amount: tx.wallet_deduction_amount ?? null,
    hub_id: hubId,
    hub: user.hub,
    entered_by: user.id && user.id.includes('-') && user.id.length > 30 ? user.id : undefined,
    customer_phone: tx.consigneePhone || null,
    is_debt_clearance: tx.is_debt_clearance ?? false,
    related_tx_id: tx.related_tx_id ?? null,
    remark: (tx as any).remarks || null,
    created_at: tx.created_at || new Date().toISOString()
  };
}
