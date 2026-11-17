import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../ui';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useHubRoutes, useValidatedRouteSelection } from '../../lib/hubRoutes';

export interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
  active: boolean;
}

export interface CorporateRouteRate {
  id: string;
  corporate_client_id: string;
  route_name: string;
  rate_per_kg: number;
  minimum_amount?: number;
}

export const PricingConfiguration = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [standardRates, setStandardRates] = useState<Record<string, number>>({});
  
  const [corpClients, setCorpClients] = useState<CorporateClient[]>([]);
  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>([]);
  
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [selectedRateClient, setSelectedRateClient] = useState<CorporateClient | null>(null);
  const routes = useHubRoutes();
  const [rateRoute, setRateRoute] = useState(routes[0]);
  useValidatedRouteSelection(routes, rateRoute, setRateRoute);
  const [ratePrice, setRatePrice] = useState('');
  const [rateMinCharge, setRateMinCharge] = useState('');
  const { showToast } = useToast();

  // Fetch standard rates from Supabase
  useEffect(() => {
    const fetchStandardRates = async () => {
      const { data, error } = await supabase.from('standard_cargo_rates').select('route_name,rate_per_kg');
      if (data && !error && data.length > 0) {
        const ratesMap: Record<string, number> = {};
        data.forEach(d => {
          ratesMap[d.route_name] = d.rate_per_kg;
        });
        setStandardRates(ratesMap);
      } else {
        // Deliberately left empty (not a synthesized ₦500/kg default) --
        // matches CargoForm.tsx's own equivalent fetch, which was fixed to
        // do the same. A guessed default here was visually indistinguishable
        // from a real saved rate (defaultValue={standardRates[r] || ''}), so
        // an admin could click "save" on what looked like an existing rate
        // without realizing nothing was actually configured, silently
        // locking in a fake company-wide rate for every route.
        setStandardRates({});
      }
    };
    fetchStandardRates();
  }, []);

  // Fetch corp clients and rates from Supabase
  useEffect(() => {
    const fetchCorpData = async () => {
      const [{ data: clients }, { data: rates }] = await Promise.all([
        supabase.from('corporate_clients').select('id,company_name,contact_phone,accumulated_monthly_debt,active'),
        supabase.from('corporate_route_rates').select('id,corporate_client_id,route_name,rate_per_kg,minimum_amount')
      ]);

      if (clients) {
        setCorpClients(clients);
      }
      if (rates) {
        setCorpRates(rates);
      }
    };
    fetchCorpData();
  }, []);

  const handleUpdateStandardRate = async (route: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const prev = standardRates;
    setStandardRates({ ...standardRates, [route]: num });

    const { error } = await supabase.from('standard_cargo_rates').upsert({
      route_name: route,
      rate_per_kg: num,
      updated_at: new Date().toISOString()
    }, { onConflict: 'route_name' });
    if (error) {
      // Roll back the optimistic update -- otherwise the screen shows a
      // rate that was never actually saved, and every other device keeps
      // using the real (unchanged) server value.
      setStandardRates(prev);
      showToast({ message: `Failed to save ${route} rate: ${error.message}`, type: 'error' });
    }
  };

  const handleCreateCorpClient = async () => {
    // Canonical form: UPPERCASE, trimmed, internal whitespace collapsed --
    // mirrors the DB's normalize_company_name() so what we check against and
    // what gets stored are identical.
    const normalizedName = newClientName.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!normalizedName) return;

    // Reject case/space-only duplicates client-side with a friendly message
    // instead of surfacing the DB's raw unique-violation error.
    if (corpClients.some(c => c.company_name.toUpperCase().replace(/\s+/g, ' ') === normalizedName)) {
      showToast({ message: `${normalizedName} already exists.`, type: 'warning' });
      return;
    }

    // corporate_clients.id is a real `uuid` column (DEFAULT gen_random_uuid())
    // -- a client-generated id like "corp_<timestamp>" isn't valid UUID
    // syntax, so this insert failed unconditionally with every attempt.
    // Let the DB generate the real id and read it back instead.
    const { data, error } = await supabase.from('corporate_clients').insert({
      company_name: normalizedName,
      contact_phone: newClientPhone.trim(),
      created_at: new Date().toISOString()
    }).select().single();
    if (error) {
      // Do not add to local state on failure -- a client that only exists
      // in this browser's memory (e.g. a duplicate company_name rejected
      // by the DB's unique constraint) would look real here but be
      // invisible on every other device.
      showToast({ message: `Failed to create ${newClientName}: ${error.message}`, type: 'error' });
      return;
    }

    const newClient: CorporateClient = { id: data.id, company_name: data.company_name, contact_phone: data.contact_phone, accumulated_monthly_debt: data.accumulated_monthly_debt, active: data.active ?? true };
    setCorpClients([...corpClients, newClient]);
    setNewClientName('');
    setNewClientPhone('');
    setSelectedRateClient(newClient);
  };

  const handleToggleClientActive = async (client: CorporateClient) => {
    const nextActive = !client.active;
    const prev = corpClients;
    const next = corpClients.map(c => c.id === client.id ? { ...c, active: nextActive } : c);
    setCorpClients(next);
    if (selectedRateClient?.id === client.id) setSelectedRateClient({ ...client, active: nextActive });

    const { error } = await supabase.from('corporate_clients').update({ active: nextActive }).eq('id', client.id);
    if (error) {
      // Roll back -- otherwise this screen shows a status that was never
      // actually saved, and intake forms elsewhere keep matching/ignoring
      // this client based on the real (unchanged) server value.
      setCorpClients(prev);
      if (selectedRateClient?.id === client.id) setSelectedRateClient(client);
      showToast({ message: `Failed to ${nextActive ? 'reactivate' : 'deactivate'} ${client.company_name}: ${error.message}`, type: 'error' });
      return;
    }
    showToast({ message: `${client.company_name} ${nextActive ? 'reactivated' : 'deactivated'}.`, type: 'success' });
  };

  const handleDeleteCorpRate = async (rate: CorporateRouteRate) => {
    const prev = corpRates;
    setCorpRates(corpRates.filter(r => r.id !== rate.id));

    const { error } = await supabase.from('corporate_route_rates').delete().eq('id', rate.id);
    if (error) {
      setCorpRates(prev);
      showToast({ message: `Failed to delete rate for ${rate.route_name}: ${error.message}`, type: 'error' });
    }
  };

  const handleSetCorpRate = async () => {
    if (!selectedRateClient || !ratePrice) return;
    const priceNum = parseFloat(ratePrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast({ message: 'Tariff must be a positive number.', type: 'warning' });
      return;
    }
    // Minimum charge must be zero or positive -- unlike the tariff above,
    // `parseFloat(rateMinCharge) || 0` alone doesn't reject a negative
    // number (only NaN/0), so a typo like "-1500" saved silently with no
    // admin feedback.
    const minChargeNum = parseFloat(rateMinCharge) || 0;
    if (minChargeNum < 0) {
      showToast({ message: 'Minimum charge must be zero or positive.', type: 'warning' });
      return;
    }
    const effectiveRoute = rateRoute;

    // Upsert on the (corporate_client_id, route_name) unique constraint
    // instead of branching on whether *this device's* stale local corpRates
    // snapshot already has a row for this client/route -- deciding insert
    // vs. update from local state races if two devices set the same
    // client's rate around the same time: both would see no existing row
    // and both attempt INSERT, and the second would fail on the unique
    // constraint with no error handling. An upsert is correct either way
    // regardless of what this device has actually seen.
    const { data, error } = await supabase.from('corporate_route_rates').upsert({
      corporate_client_id: selectedRateClient.id,
      route_name: effectiveRoute,
      rate_per_kg: priceNum,
      minimum_amount: minChargeNum,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'corporate_client_id,route_name' }).select().single();

    if (error) {
      showToast({ message: `Failed to save rate: ${error.message}`, type: 'error' });
      return;
    }

    setCorpRates(prev => {
      const idx = prev.findIndex(r => r.corporate_client_id === selectedRateClient.id && r.route_name === effectiveRoute);
      const saved: CorporateRouteRate = {
        id: data.id,
        corporate_client_id: data.corporate_client_id,
        route_name: data.route_name,
        rate_per_kg: data.rate_per_kg,
        minimum_amount: data.minimum_amount
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setRatePrice('');
    setRateMinCharge('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing Configuration"
        subtitle="Manage standard retail rates and B2B negotiated tariffs"
        onBack={onBack}
        sticky={false}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Standard Rates Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] mb-4">Standard Retail Rates</h3>
          <p className="text-[11px] text-[var(--color-muted)] mb-4 leading-relaxed">
            These rates auto-calculate for retail cargo entries based on weight and route.
          </p>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {routes.map(r => (
              <div key={r} className="flex justify-between items-center bg-[var(--color-surface-2)] p-2 rounded">
                <span className="text-[12px] font-mono text-[var(--color-light-muted)]">{r}</span>
                <div className="flex items-center space-x-2">
                  <span className="text-[12px] font-mono text-[var(--color-muted)]">₦</span>
                  <input
                    type="number"
                    defaultValue={standardRates[r] || ''}
                    key={`standard-rate-${r}-${standardRates[r] ?? 'empty'}`}
                    placeholder="Not configured"
                    onBlur={(e) => e.target.value && handleUpdateStandardRate(r, e.target.value)}
                    className="w-24 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] font-mono text-[var(--color-foreground)] text-right focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                  <span className="text-[10px] text-[var(--color-muted)]">/KG</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* B2B Clients Panel */}
        <div className="bg-[var(--color-surface-1)] p-5 rounded-xl border border-[var(--color-border)] flex flex-col">
          <h3 className="text-[14px] font-sans font-bold text-[var(--color-foreground)] mb-4">B2B Clients & Negotiated Rates</h3>
          <div className="flex space-x-2 mb-6">
            <input 
              type="text"
              placeholder="Company Name"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="flex-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded px-3 py-2 text-[12px] focus:border-[var(--color-accent-amber)] outline-none"
            />
            <button 
              onClick={handleCreateCorpClient}
              disabled={!newClientName.trim()}
              className="bg-[var(--color-accent-amber)] hover:bg-amber-600 disabled:opacity-50 text-[var(--color-on-accent)] px-4 py-2 rounded text-[12px] font-bold font-sans flex items-center space-x-1 transition-colors"
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-4 flex-1">
            {/* Client List */}
            <div className="w-full md:w-1/2 space-y-2 overflow-y-auto max-h-[300px] border-r border-[var(--color-border)] pr-2">
              {corpClients.map(c => (
                <div
                  key={c.id}
                  onClick={() => setSelectedRateClient(c)}
                  className={`p-3 rounded border cursor-pointer transition-colors ${c.active === false ? 'opacity-50' : ''} ${selectedRateClient?.id === c.id ? 'bg-[var(--color-amber-bg)] border-[var(--color-accent-amber)]' : 'bg-[var(--color-surface-1)] border-[var(--color-border)] hover:border-[var(--color-muted)]'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="font-bold text-[12px] text-[var(--color-foreground)]">{c.company_name}</div>
                    {c.active === false && (
                      <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-error-bg)] text-[var(--color-error-fg)] border border-[var(--color-error)]">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[10px] text-[var(--color-muted)] font-mono">{corpRates.filter(r => r.corporate_client_id === c.id).length} routes configured</div>
                    <div className="text-[10px] font-mono font-bold" style={{ color: (c.accumulated_monthly_debt || 0) > 0 ? 'var(--color-error)' : 'var(--color-muted)' }}>
                      ₦{(c.accumulated_monthly_debt || 0).toLocaleString()} owed
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Rate Editor */}
            <div className="w-full md:w-1/2">
              {selectedRateClient ? (
                <div className="flex flex-col h-full space-y-4 pl-0 md:pl-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]">
                    <div className="text-[14px] font-bold text-[var(--color-accent-amber)]">{selectedRateClient.company_name}</div>
                    <button
                      onClick={() => handleToggleClientActive(selectedRateClient)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${selectedRateClient.active === false ? 'bg-[var(--color-success-bg)] text-[var(--color-success-fg)] hover:bg-[var(--color-success)] hover:text-[var(--color-on-accent)]' : 'bg-[var(--color-error-bg)] text-[var(--color-error-fg)] hover:bg-[var(--color-error)] hover:text-[var(--color-on-accent-inverse)]'}`}
                    >
                      {selectedRateClient.active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </div>
                  
                  <div className="bg-[var(--color-surface-2)] p-4 rounded-lg border border-[var(--color-border)] space-y-4">
                    <div className="flex flex-col space-y-3">
                      <div>
                        <label htmlFor="corp-route" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Route</label>
                        <select
                          id="corp-route"
                          value={rateRoute}
                          onChange={(e) => setRateRoute(e.target.value)}
                          className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        >
                          {routes.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="corp-tariff" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Tariff (₦/KG)</label>
                        <input
                          id="corp-tariff"
                          type="number"
                          value={ratePrice}
                          onChange={(e) => setRatePrice(e.target.value)}
                          placeholder="e.g. 450"
                          className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        />
                      </div>
                      <div>
                        <label htmlFor="corp-min-charge" className="text-[11px] font-medium text-[var(--color-muted)] block mb-1.5">Minimum Charge (₦) -- optional</label>
                        <input
                          id="corp-min-charge"
                          type="number"
                          value={rateMinCharge}
                          onChange={(e) => setRateMinCharge(e.target.value)}
                          placeholder="e.g. 15000"
                          className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] transition-colors"
                        />
                      </div>
                      <button
                        onClick={handleSetCorpRate}
                        disabled={!ratePrice || isNaN(parseFloat(ratePrice)) || parseFloat(ratePrice) <= 0}
                        className="w-full bg-[var(--color-accent-amber)] hover:bg-amber-600 text-[var(--color-on-accent)] py-2 rounded-md text-[12px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                      >
                        Set Rate
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-1 space-y-2 mt-4">
                    <div className="text-[11px] text-[var(--color-muted)] uppercase tracking-wider font-semibold mb-3">Configured Routes</div>
                    <div className="space-y-2">
                      {corpRates.filter(r => r.corporate_client_id === selectedRateClient.id).map(r => (
                        <div key={r.id} className="flex justify-between items-center bg-[var(--color-surface-1)] border border-[var(--color-border)] px-3 py-2.5 rounded-md">
                          <span className="text-[12px] text-[var(--color-light-muted)] font-medium">{r.route_name}</span>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-[13px] text-[var(--color-accent-amber)] font-bold font-mono">₦{r.rate_per_kg}/KG</span>
                              {r.minimum_amount && r.minimum_amount > 0 ? (
                                <div className="text-[9px] font-mono text-[var(--color-muted)] mt-0.5">Min: ₦{r.minimum_amount.toLocaleString()}</div>
                              ) : null}
                            </div>
                            <button
                              onClick={() => handleDeleteCorpRate(r)}
                              aria-label={`Delete rate for ${r.route_name}`}
                              className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-error)] transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {corpRates.filter(r => r.corporate_client_id === selectedRateClient.id).length === 0 && (
                        <div className="text-[12px] text-[var(--color-muted)] italic text-center py-6 bg-[var(--color-surface-2)] rounded-md border border-[var(--color-border-subtle)]">
                          No custom rates set.<br/>Baseline standard rate will apply.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12px] text-[var(--color-muted)] text-center p-4">
                  Select a B2B client to configure negotiated route rates
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
